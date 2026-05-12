import { NextRequest } from "next/server";
import { jsonrepair } from "jsonrepair";
import { getKimiClient, MOONSHOT_MODEL } from "@/lib/llm";
import { briefSchema, planLLMSchema } from "@/lib/schemas";
import {
  GENERATE_SYSTEM_PROMPT,
  buildGenerateUserPrompt,
} from "@/lib/prompts/generate";
import { CATALOG } from "@/lib/catalog";
import { assessDspGate } from "@/lib/generatePlan";
import { validatePlan } from "@/lib/validate";
import type { Brief, Capability, Plan, PlanLine } from "@/lib/types";

export const runtime = "nodejs";

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function dollarsFromPct(budget: number, pct: number): number {
  return Math.round(budget * (pct / 100));
}

function retrieveCapabilities(brief: Brief): Capability[] {
  const channels = new Set(brief.channelsInScope);
  return CATALOG.filter(
    (c) =>
      c.channels.some((ch) => channels.has(ch)) ||
      c.kpis.includes(brief.kpi) ||
      c.vendorTypes.includes("AdCP") ||
      c.id === "frequency-cap-adserver"
  );
}

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  let body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end > start) body = body.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    return JSON.parse(jsonrepair(body));
  }
}

async function callKimi(
  brief: Brief,
  dspAssessment: ReturnType<typeof assessDspGate>,
  capabilities: Capability[],
  errorContext?: string
) {
  const client = getKimiClient();
  const messages = [
    { role: "system" as const, content: GENERATE_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildGenerateUserPrompt(brief, dspAssessment, capabilities),
    },
  ];
  if (errorContext) {
    messages.push({
      role: "user",
      content: `Your previous plan failed validation:\n${errorContext}\nFix the errors and return ONLY the corrected JSON object.`,
    });
  }
  const completion = await client.chat.completions.create({
    model: MOONSHOT_MODEL,
    messages,
    temperature: 0.3,
    response_format: { type: "json_object" },
  });
  return completion.choices[0]?.message?.content ?? "";
}

function assemblePlan(
  brief: Brief,
  llmLines: Array<{
    vendor: string;
    vendorType: "SSP" | "DSP" | "AdCP";
    channel: string;
    spendPct: number;
    dealRefs: string[];
    capabilityIds: string[];
    rationale: string;
    allocationRationale: string;
    dspJustification: string | null;
  }>,
  dspAssessment: ReturnType<typeof assessDspGate>
): Plan {
  const budget = brief.budgetDollars;
  const lines: PlanLine[] = llmLines.map((l) => ({
    id: newId(),
    vendor: l.vendor,
    vendorType: l.vendorType,
    channel: l.channel,
    spendPct: Math.round(l.spendPct * 100) / 100,
    spendDollars: dollarsFromPct(budget, l.spendPct),
    dealRefs: l.dealRefs,
    capabilityIds: l.capabilityIds,
    rationale: l.rationale,
    allocationRationale: l.allocationRationale,
    dspJustification: l.vendorType === "DSP" ? l.dspJustification : null,
  }));
  return {
    brief,
    lines,
    totalBudget: lines.reduce((s, l) => s + l.spendDollars, 0),
    generatedAt: new Date().toISOString(),
    dspAssessment,
  };
}

export async function POST(request: NextRequest) {
  let body: { brief?: Brief };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const briefParsed = briefSchema.safeParse(body.brief);
  if (!briefParsed.success) {
    return Response.json(
      { error: "invalid_brief", detail: briefParsed.error.issues },
      { status: 400 }
    );
  }
  const brief = briefParsed.data as Brief;

  const startedAt = Date.now();
  const dspAssessment = assessDspGate(brief);
  const capabilities = retrieveCapabilities(brief);

  async function attempt(errorContext?: string) {
    try {
      const raw = await callKimi(brief, dspAssessment, capabilities, errorContext);
      let parsed: unknown;
      try {
        parsed = tryParseJson(raw);
      } catch (e) {
        return {
          ok: false as const,
          errorContext: `JSON parse failed: ${
            e instanceof Error ? e.message : "unknown"
          }. Output started with: ${raw.slice(0, 200)}`,
        };
      }
      const llmCheck = planLLMSchema.safeParse(parsed);
      if (!llmCheck.success) {
        return {
          ok: false as const,
          errorContext: llmCheck.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n"),
        };
      }
      const plan = assemblePlan(brief, llmCheck.data.lines, dspAssessment);
      const validation = validatePlan(plan);
      if (!validation.ok) {
        return {
          ok: false as const,
          errorContext: validation.errors.join("\n"),
          plan,
          validation,
        };
      }
      return { ok: true as const, plan, validation };
    } catch (e) {
      return {
        ok: false as const,
        errorContext: `LLM call failed: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      };
    }
  }

  let result = await attempt();
  if (!result.ok) {
    result = await attempt(result.errorContext);
  }
  if (!result.ok) {
    result = await attempt(result.errorContext);
  }

  if (!result.ok) {
    return Response.json(
      {
        error: "generation_failed",
        detail: result.errorContext,
        plan: result.plan ?? null,
        validation: result.validation ?? null,
        latencyMs: Date.now() - startedAt,
      },
      { status: 502 }
    );
  }

  return Response.json({
    plan: result.plan,
    validation: result.validation,
    dspAssessment,
    model: MOONSHOT_MODEL,
    latencyMs: Date.now() - startedAt,
  });
}
