"use client";

import { useState } from "react";
import type { DspAssessment, Plan, PlanLine, VendorType } from "@/lib/types";
import { getCapability } from "@/lib/catalog";

type ExpandableField = "rationale" | "allocationRationale";
type ExpandedKey = `${string}-${ExpandableField}`;

const COL_WIDTHS = {
  vendor: 120,
  type: 64,
  channel: 88,
  spendPct: 96,
  spendDollars: 112,
  deals: 168,
  capabilities: 168,
  rationale: 240,
  allocation: 220,
  dspJustification: 260,
} as const;

function formatDollars(n: number): string {
  return n.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
}

function VendorBadge({ type }: { type: VendorType }) {
  const styles: Record<VendorType, string> = {
    SSP: "bg-zinc-100 text-zinc-800 ring-zinc-300",
    AdCP: "bg-zinc-100 text-zinc-800 ring-zinc-300",
    DSP: "bg-zinc-900 text-white ring-zinc-900",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${styles[type]}`}
    >
      {type}
    </span>
  );
}

function SkeletonBar({ width }: { width: string }) {
  return (
    <div
      className={`h-3 rounded bg-zinc-200 motion-safe:animate-pulse ${width}`}
    />
  );
}

function SkeletonRow() {
  return (
    <tr>
      <td className="px-3 py-3"><SkeletonBar width="w-20" /></td>
      <td className="px-3 py-3"><SkeletonBar width="w-10" /></td>
      <td className="px-3 py-3"><SkeletonBar width="w-14" /></td>
      <td className="px-3 py-3"><SkeletonBar width="w-10" /></td>
      <td className="px-3 py-3"><SkeletonBar width="w-20" /></td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <SkeletonBar width="w-32" />
          <SkeletonBar width="w-28" />
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <SkeletonBar width="w-32" />
          <SkeletonBar width="w-24" />
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <SkeletonBar width="w-full" />
          <SkeletonBar width="w-3/4" />
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <SkeletonBar width="w-full" />
          <SkeletonBar width="w-2/3" />
        </div>
      </td>
      <td className="px-3 py-3"><SkeletonBar width="w-3/4" /></td>
    </tr>
  );
}

function EditableProseCell({
  value,
  edited,
  expanded,
  onEdit,
  onExpand,
  onCollapse,
  textClass,
}: {
  value: string;
  edited: boolean;
  expanded: boolean;
  onEdit: (v: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
  textClass: string;
}) {
  if (expanded) {
    return (
      <textarea
        value={value}
        onChange={(e) => onEdit(e.target.value)}
        onBlur={onCollapse}
        rows={5}
        className={`w-full rounded border border-zinc-900 bg-white px-2 py-1 ${textClass} focus:outline-none`}
        autoFocus
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onExpand}
      className={
        `block w-full cursor-text text-left leading-snug line-clamp-2 ${textClass} ` +
        (edited
          ? "border-b border-solid border-zinc-900 font-medium"
          : "border-b border-transparent hover:border-dotted hover:border-zinc-400")
      }
    >
      {value}
    </button>
  );
}

export function PlanTable({
  plan,
  onChange,
  streaming,
  expectedLineCount,
  assessment,
  originalLines,
}: {
  plan: Plan;
  onChange: (lines: PlanLine[]) => void;
  streaming: boolean;
  expectedLineCount: number;
  assessment?: DspAssessment;
  originalLines?: PlanLine[];
}) {
  const [expanded, setExpanded] = useState<Record<ExpandedKey, boolean>>({});

  function setFieldExpanded(id: string, field: ExpandableField, open: boolean) {
    setExpanded((s) => ({ ...s, [`${id}-${field}` as ExpandedKey]: open }));
  }

  function updateLine(id: string, patch: Partial<PlanLine>) {
    onChange(plan.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function ceilingForDsp(vendor: string): { ceiling: number; reason: string } | null {
    if (!assessment) return null;
    const e = assessment.eligible.find((v) => v.vendor === vendor);
    if (!e) return null;
    return { ceiling: e.shareCeiling, reason: e.shareCeilingReason };
  }

  function originalLine(id: string): PlanLine | undefined {
    return originalLines?.find((l) => l.id === id);
  }

  const totalPct = plan.lines.reduce((s, l) => s + l.spendPct, 0);
  const totalDollars = plan.lines.reduce((s, l) => s + l.spendDollars, 0);
  const dspShare = plan.lines
    .filter((l) => l.vendorType === "DSP")
    .reduce((s, l) => s + l.spendPct, 0);

  const skeletonCount = Math.max(0, expectedLineCount - plan.lines.length);

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: COL_WIDTHS.vendor }} />
          <col style={{ width: COL_WIDTHS.type }} />
          <col style={{ width: COL_WIDTHS.channel }} />
          <col style={{ width: COL_WIDTHS.spendPct }} />
          <col style={{ width: COL_WIDTHS.spendDollars }} />
          <col style={{ width: COL_WIDTHS.deals }} />
          <col style={{ width: COL_WIDTHS.capabilities }} />
          <col style={{ width: COL_WIDTHS.rationale }} />
          <col style={{ width: COL_WIDTHS.allocation }} />
          <col style={{ width: COL_WIDTHS.dspJustification }} />
        </colgroup>
        <thead className="border-b-2 border-zinc-300 bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
          <tr>
            <th className="px-3 py-2.5">Vendor</th>
            <th className="px-3 py-2.5">Type</th>
            <th className="px-3 py-2.5">Channel</th>
            <th className="px-3 py-2.5 text-right">Spend %</th>
            <th className="px-3 py-2.5 text-right">Spend $</th>
            <th className="px-3 py-2.5">Deal / PMP</th>
            <th className="px-3 py-2.5">Capabilities</th>
            <th className="px-3 py-2.5">Rationale</th>
            <th className="px-3 py-2.5">Allocation rationale</th>
            <th className="px-3 py-2.5">DSP Justification</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {plan.lines.map((line) => {
            const isDsp = line.vendorType === "DSP";
            const ceiling = isDsp ? ceilingForDsp(line.vendor) : null;
            const overCeiling = ceiling ? line.spendPct > ceiling.ceiling : false;
            const orig = originalLine(line.id);
            const spendEdited = orig ? orig.spendPct !== line.spendPct : false;
            const rationaleEdited = orig ? orig.rationale !== line.rationale : false;
            const allocationEdited = orig
              ? orig.allocationRationale !== line.allocationRationale
              : false;

            return (
              <tr key={line.id}>
                <td className="px-3 py-3 align-top font-semibold text-zinc-900">
                  {line.vendor}
                </td>
                <td className="px-3 py-3 align-top">
                  <VendorBadge type={line.vendorType} />
                </td>
                <td className="px-3 py-3 align-top text-[13px] text-zinc-700">
                  {line.channel}
                </td>
                <td className="px-3 py-3 align-top text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={line.spendPct}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        updateLine(line.id, {
                          spendPct: v,
                          spendDollars: Math.round(plan.brief.budgetDollars * (v / 100)),
                        });
                      }}
                      className={
                        "w-14 rounded border-b border-dotted bg-transparent px-1 py-0.5 text-right text-base tabular font-semibold focus:border-solid focus:border-zinc-900 focus:outline-none " +
                        (spendEdited
                          ? "border-zinc-900"
                          : "border-zinc-400 hover:border-zinc-700")
                      }
                    />
                    <span className="text-sm text-zinc-500">%</span>
                  </div>
                  {overCeiling && ceiling && (
                    <div
                      className="mt-1 inline-flex items-center gap-1 text-[10px] leading-tight text-amber-900"
                      title={ceiling.reason}
                    >
                      <span aria-hidden>▲</span>
                      over ceiling of {ceiling.ceiling}%
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 align-top text-right tabular text-zinc-700">
                  {formatDollars(line.spendDollars)}
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex flex-col gap-1">
                    {line.dealRefs.map((d) => (
                      <code
                        key={d}
                        className="mono inline-block w-fit rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-800"
                      >
                        {d}
                      </code>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <ul className="flex flex-col gap-0.5">
                    {line.capabilityIds.map((id) => {
                      const cap = getCapability(id);
                      return (
                        <li
                          key={id}
                          title={cap?.description ?? id}
                          className="text-[12px] text-zinc-700"
                        >
                          {cap?.name ?? id}
                        </li>
                      );
                    })}
                  </ul>
                </td>
                <td className="px-3 py-3 align-top">
                  <EditableProseCell
                    value={line.rationale}
                    edited={rationaleEdited}
                    expanded={!!expanded[`${line.id}-rationale`]}
                    onEdit={(v) => updateLine(line.id, { rationale: v })}
                    onExpand={() => setFieldExpanded(line.id, "rationale", true)}
                    onCollapse={() => setFieldExpanded(line.id, "rationale", false)}
                    textClass="text-sm text-zinc-900"
                  />
                </td>
                <td className="px-3 py-3 align-top">
                  <EditableProseCell
                    value={line.allocationRationale}
                    edited={allocationEdited}
                    expanded={!!expanded[`${line.id}-allocationRationale`]}
                    onEdit={(v) => updateLine(line.id, { allocationRationale: v })}
                    onExpand={() => setFieldExpanded(line.id, "allocationRationale", true)}
                    onCollapse={() => setFieldExpanded(line.id, "allocationRationale", false)}
                    textClass="text-[12px] text-zinc-600"
                  />
                </td>
                <td className="px-3 py-3 align-top">
                  {line.dspJustification ? (
                    <div className="border-l-2 border-amber-500 pl-2 text-[12px] leading-snug text-amber-900 line-clamp-3">
                      {line.dspJustification}
                    </div>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {streaming &&
            Array.from({ length: skeletonCount }).map((_, i) => <SkeletonRow key={`sk-${i}`} />)}
        </tbody>
        <tfoot className="border-t-2 border-zinc-300 bg-zinc-50 text-xs">
          <tr>
            <td colSpan={3} className="px-3 py-2 font-medium text-zinc-700">
              Total ({plan.lines.length} line{plan.lines.length === 1 ? "" : "s"})
            </td>
            <td className="px-3 py-2 text-right tabular font-semibold">
              <span
                className={
                  Math.abs(totalPct - 100) > 0.5 ? "text-red-700" : "text-zinc-900"
                }
              >
                {totalPct.toFixed(0)}%
              </span>
            </td>
            <td className="px-3 py-2 text-right tabular font-semibold text-zinc-900">
              {formatDollars(totalDollars)}
            </td>
            <td colSpan={4} className="px-3 py-2 text-zinc-400">
              {/* spacer under reference + prose columns */}
            </td>
            <td className="px-3 py-2 text-right text-zinc-700">
              DSP share:{" "}
              <span
                className={
                  "tabular font-semibold " +
                  (dspShare > 25 ? "text-amber-800" : "text-zinc-900")
                }
              >
                {dspShare.toFixed(0)}%
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
      {streaming && (
        <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-700">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700 motion-safe:animate-pulse" />
            Generating line {plan.lines.length + 1} of {expectedLineCount}…
          </span>
        </div>
      )}
    </div>
  );
}
