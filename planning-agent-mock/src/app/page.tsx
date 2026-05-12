"use client";

import { useRef, useState } from "react";
import type { Brief, DspAssessment, Plan, PlanLine } from "@/lib/types";
import { recomputePlanTotals } from "@/lib/generatePlan";
import { validatePlan } from "@/lib/validate";
import { planToCSV, planToMarkdown } from "@/lib/export";
import { BriefInput } from "@/components/BriefInput";
import { ConfirmationView } from "@/components/ConfirmationView";
import { PlanTable } from "@/components/PlanTable";

type Step = "brief" | "confirm" | "generating" | "plan" | "error";

const STEPS: { key: Step; label: string }[] = [
  { key: "brief", label: "Brief" },
  { key: "confirm", label: "Confirm" },
  { key: "plan", label: "Plan" },
];

export default function Home() {
  const [step, setStep] = useState<Step>("brief");
  const [briefText, setBriefText] = useState("");
  const [structuredBrief, setStructuredBrief] = useState<Brief | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [originalPlan, setOriginalPlan] = useState<Plan | null>(null);
  const [streamedLines, setStreamedLines] = useState<PlanLine[]>([]);
  const [expectedLineCount, setExpectedLineCount] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [copyAck, setCopyAck] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  async function handleBriefSubmit(text: string) {
    setBriefText(text);
    setExtractError(null);
    setExtracting(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawText: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : data?.detail
            ? JSON.stringify(data.detail)
            : null;
        throw new Error(
          [data?.error, detail, data?.message].filter(Boolean).join(" — ") ||
            `Extraction failed (${res.status})`
        );
      }
      setStructuredBrief(data.brief as Brief);
      setStep("confirm");
    } catch (e) {
      setExtractError(
        e instanceof Error ? e.message : "Unknown extraction error"
      );
    } finally {
      setExtracting(false);
    }
  }

  async function runGeneration(brief: Brief) {
    setStructuredBrief(brief);
    setGenerationError(null);
    cancelRef.current = false;

    try {
      setExpectedLineCount(6);
      setStreamedLines([]);
      setStep("generating");
      setStreaming(true);

      const res = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : data?.detail
            ? JSON.stringify(data.detail)
            : null;
        throw new Error(
          [data?.error, detail, data?.message].filter(Boolean).join(" — ") ||
            `Generation failed (${res.status})`
        );
      }

      const fullPlan = data.plan as Plan;
      if (cancelRef.current) {
        setStreaming(false);
        return;
      }
      setExpectedLineCount(fullPlan.lines.length);
      setPlan({ ...fullPlan, lines: [] });
      setOriginalPlan(fullPlan);

      for (let i = 0; i < fullPlan.lines.length; i++) {
        await new Promise((r) => setTimeout(r, 280));
        if (cancelRef.current) {
          setStreaming(false);
          return;
        }
        setStreamedLines((prev) => [...prev, fullPlan.lines[i]]);
      }
      await new Promise((r) => setTimeout(r, 160));
      if (cancelRef.current) {
        setStreaming(false);
        return;
      }
      setPlan(fullPlan);
      setStreaming(false);
      setStep("plan");
    } catch (e) {
      setStreaming(false);
      setGenerationError(
        e instanceof Error ? e.message : "Unknown error during generation"
      );
      setStep("error");
    }
  }

  function handleCancelGeneration() {
    cancelRef.current = true;
    setStreaming(false);
    setStep("confirm");
  }

  function handleLinesChange(lines: PlanLine[]) {
    if (!plan) return;
    setPlan(recomputePlanTotals({ ...plan, lines }));
  }

  function handleRegenerate() {
    if (!structuredBrief) return;
    const ok =
      editCount === 0 ||
      window.confirm(
        `Regenerate will replace your current draft and discard ${editCount} edit${editCount === 1 ? "" : "s"}. Continue?`
      );
    if (!ok) return;
    runGeneration(structuredBrief);
  }

  function handleNewPlan() {
    const ok = window.confirm(
      "Start a new plan? Your current draft and any edits will be cleared."
    );
    if (!ok) return;
    setStep("brief");
    setBriefText("");
    setStructuredBrief(null);
    setPlan(null);
    setOriginalPlan(null);
    setStreamedLines([]);
    setStreaming(false);
    setGenerationError(null);
    setExpectedLineCount(0);
  }

  async function handleCopyMarkdown() {
    if (!plan) return;
    await navigator.clipboard.writeText(planToMarkdown(plan));
    setCopyAck(true);
    setTimeout(() => setCopyAck(false), 1800);
  }

  function handleExportCSV() {
    if (!plan) return;
    const csv = planToCSV(plan);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-${plan.brief.advertiser.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const editCount: number = (() => {
    if (!plan || !originalPlan) return 0;
    let count = 0;
    for (let i = 0; i < plan.lines.length; i++) {
      const cur = plan.lines[i];
      const orig = originalPlan.lines.find((l) => l.id === cur.id);
      if (!orig) continue;
      if (cur.spendPct !== orig.spendPct) count++;
      if (cur.rationale !== orig.rationale) count++;
      if (cur.allocationRationale !== orig.allocationRationale) count++;
    }
    return count;
  })();

  const displayPlan: Plan | null =
    step === "generating" && plan
      ? { ...plan, lines: streamedLines }
      : plan;

  const validation = plan && step === "plan" ? validatePlan(plan) : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tracking-tight">KleverOne</span>
            <span className="text-sm text-zinc-700">Planning Agent</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-700">
              Mock
            </span>
          </div>
          <Stepper current={step} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {step === "brief" && (
          <div>
            <BriefInput onSubmit={handleBriefSubmit} />
            {extracting && (
              <div className="mt-3">
                <LoadingPill label="Extracting brief with Kimi…" />
              </div>
            )}
            {extractError && (
              <div className="mt-3 rounded-md border border-red-200 border-l-4 border-l-red-600 bg-red-50 p-3 text-xs text-red-900">
                <div className="mb-1 font-semibold uppercase tracking-wide">
                  Extraction failed
                </div>
                <div className="whitespace-pre-wrap break-words">{extractError}</div>
                <div className="mt-2 text-red-800">
                  Check that <code>MOONSHOT_API_KEY</code>,{" "}
                  <code>MOONSHOT_BASE_URL</code>, and <code>MOONSHOT_MODEL</code>{" "}
                  are set on the server (Railway Variables or local{" "}
                  <code>.env.local</code>).
                </div>
              </div>
            )}
          </div>
        )}

        {step === "confirm" && structuredBrief && (
          <ConfirmationView
            initialBrief={structuredBrief}
            onBack={() => setStep("brief")}
            onConfirm={runGeneration}
          />
        )}

        {step === "error" && (
          <ErrorRecovery
            message={generationError}
            onRetry={() => structuredBrief && runGeneration(structuredBrief)}
            onEditBrief={() => setStep("confirm")}
          />
        )}

        {(step === "generating" || step === "plan") && displayPlan && structuredBrief && (
          <div>
            <div className="mb-6 flex items-start justify-between gap-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Draft plan — {structuredBrief.advertiser}
                </h2>
                <p className="mt-1 text-sm text-zinc-700">
                  {structuredBrief.vertical} · {structuredBrief.kpi} ·{" "}
                  {structuredBrief.geo.join(", ")} · {structuredBrief.audience} ·{" "}
                  {structuredBrief.inventoryConstraint} inventory
                  {structuredBrief.exclusions.length > 0 && (
                    <> · excl: {structuredBrief.exclusions.join(", ")}</>
                  )}
                </p>
              </div>
              {step === "plan" && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyMarkdown}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    {copyAck ? "Copied" : "Copy as markdown"}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("confirm")}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    Edit fields
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={handleNewPlan}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    Start a new plan
                  </button>
                </div>
              )}
              {step === "generating" && (
                <button
                  type="button"
                  onClick={handleCancelGeneration}
                  className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  Cancel
                </button>
              )}
            </div>

            {validation && !validation.ok && (
              <div className="mb-4 flex gap-2 rounded-md border border-red-200 border-l-4 border-l-red-600 bg-red-50 p-3 text-xs text-red-900">
                <span aria-hidden className="font-semibold">⚠</span>
                <div>
                  <div className="mb-1 font-semibold uppercase tracking-wide">
                    Validation issues
                  </div>
                  <ul className="list-disc pl-5">
                    {validation.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {step === "generating" && (
              <div className="mb-4">
                <LoadingPill label="Generating plan with Kimi…" />
              </div>
            )}

            {step === "plan" && displayPlan.dspAssessment && (
              <DspAssessmentPanel assessment={displayPlan.dspAssessment} />
            )}

            {step === "plan" && editCount > 0 && (
              <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-1.5 text-xs text-zinc-800">
                <span aria-hidden>●</span>
                <span>
                  {editCount} edit{editCount === 1 ? "" : "s"} captured — these become structured feedback for the planning agent.
                </span>
              </div>
            )}

            <PlanTable
              plan={displayPlan}
              onChange={handleLinesChange}
              streaming={streaming}
              expectedLineCount={expectedLineCount}
              assessment={displayPlan.dspAssessment}
              originalLines={originalPlan?.lines}
            />

            <p className="mt-3 text-xs text-zinc-700">
              Spend % and rationale are editable inline. DSP lines carry a required
              justification — pushing a DSP line above the model&apos;s share ceiling
              surfaces an inline warning citing the original reason.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function LoadingPill({ label }: { label: string }) {
  return (
    <div
      className="inline-flex items-center gap-2.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm"
      aria-live="polite"
      role="status"
    >
      <svg
        className="h-4 w-4 animate-spin text-zinc-700 motion-reduce:animate-none"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          strokeOpacity="0.2"
        />
        <path
          d="M12 2 a 10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

function ErrorRecovery({
  message,
  onRetry,
  onEditBrief,
}: {
  message: string | null;
  onRetry: () => void;
  onEditBrief: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-6">
      <div className="mb-2 text-lg font-semibold text-zinc-900">
        We couldn&apos;t generate this plan
      </div>
      <p className="mb-4 text-sm text-zinc-700">
        {message ?? "The agent failed to produce a draft plan."} Your brief and confirmed fields are preserved — try again, or adjust the brief and regenerate.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onEditBrief}
          className="text-sm text-zinc-800 underline underline-offset-4 hover:text-zinc-900"
        >
          Edit fields and retry
        </button>
      </div>
    </div>
  );
}

function DspAssessmentPanel({ assessment }: { assessment: DspAssessment }) {
  const [expanded, setExpanded] = useState(false);
  const earnedCount = assessment.eligible.length;
  const rejectedCount = assessment.rejected.length;

  return (
    <div className="mb-4 rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-semibold uppercase tracking-wide text-zinc-700">
            DSP gate
          </span>{" "}
          ·{" "}
          <span>
            {earnedCount === 0
              ? "no DSP earned a seat on this plan"
              : `${earnedCount} DSP${earnedCount > 1 ? "s" : ""} earned a seat (${assessment.eligible.map((e) => e.vendor).join(", ")})`}
            {rejectedCount > 0 && `, ${rejectedCount} rejected`}
          </span>
        </div>
        {rejectedCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-zinc-700 underline underline-offset-4 hover:text-zinc-900"
          >
            {expanded ? "Hide reasoning" : "Show reasoning"}
          </button>
        )}
      </div>
      {expanded && rejectedCount > 0 && (
        <ul className="mt-3 space-y-2 border-t border-zinc-200 pt-3">
          {assessment.rejected.map((r) => (
            <li key={r.vendor} className="leading-relaxed">
              <span className="font-semibold">{r.vendor}:</span> {r.rejectedReason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const currentIdx =
    current === "generating" || current === "plan"
      ? 2
      : current === "error"
      ? 2
      : STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const active = i === currentIdx;
        const done = i < currentIdx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold " +
                (active
                  ? "bg-zinc-900 text-white"
                  : done
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-200 text-zinc-700")
              }
              aria-current={active ? "step" : undefined}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={active ? "font-medium text-zinc-900" : "text-zinc-700"}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="h-px w-6 bg-zinc-300" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
