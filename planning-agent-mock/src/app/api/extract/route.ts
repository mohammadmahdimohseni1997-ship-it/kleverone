import { NextRequest } from "next/server";
import { jsonrepair } from "jsonrepair";
import { getKimiClient, MOONSHOT_MODEL } from "@/lib/llm";
import { briefSchema } from "@/lib/schemas";
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
} from "@/lib/prompts/extract";

export const runtime = "nodejs";

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

async function callKimi(rawText: string, errorContext?: string) {
  const client = getKimiClient();
  const messages = [
    { role: "system" as const, content: EXTRACT_SYSTEM_PROMPT },
    { role: "user" as const, content: buildExtractUserPrompt(rawText) },
  ];
  if (errorContext) {
    messages.push({
      role: "user",
      content: `Your previous response failed validation:\n${errorContext}\nReturn a corrected JSON object that conforms to the schema. ONLY the JSON object.`,
    });
  }

  const completion = await client.chat.completions.create({
    model: MOONSHOT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return content;
}

export async function POST(request: NextRequest) {
  let body: { rawText?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawText = (body.rawText ?? "").toString();
  if (!rawText.trim()) {
    return Response.json({ error: "rawText is required" }, { status: 400 });
  }

  const startedAt = Date.now();

  async function attempt(errorContext?: string) {
    try {
      const raw = await callKimi(rawText, errorContext);
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
      const check = briefSchema.safeParse(parsed);
      if (!check.success) {
        return {
          ok: false as const,
          errorContext: check.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n"),
        };
      }
      return { ok: true as const, brief: check.data };
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
  if (!result.ok) result = await attempt(result.errorContext);
  if (!result.ok) result = await attempt(result.errorContext);

  if (!result.ok) {
    return Response.json(
      {
        error: "extraction_failed",
        detail: result.errorContext,
        latencyMs: Date.now() - startedAt,
      },
      { status: 502 }
    );
  }

  return Response.json({
    brief: result.brief,
    model: MOONSHOT_MODEL,
    latencyMs: Date.now() - startedAt,
  });
}
