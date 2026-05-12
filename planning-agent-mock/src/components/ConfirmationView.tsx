"use client";

import { useState } from "react";
import type { Brief, KPI, Goal, InventoryConstraint } from "@/lib/types";

const KPIS: KPI[] = ["VCR", "CTR", "CPM", "CPA", "Viewability", "Reach"];
const GOALS: Goal[] = ["awareness", "consideration", "performance"];
const INVENTORY: InventoryConstraint[] = ["premium", "open", "mixed"];

const INPUT =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-900 focus:outline-none";

function formatDollars(n: number): string {
  return n.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
}

export function ConfirmationView({
  initialBrief,
  onBack,
  onConfirm,
}: {
  initialBrief: Brief;
  onBack: () => void;
  onConfirm: (brief: Brief) => void;
}) {
  const [brief, setBrief] = useState<Brief>(initialBrief);

  function update<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((b) => ({ ...b, [key]: value }));
  }

  function updateList(
    key: "geo" | "exclusions" | "channelsInScope",
    value: string
  ) {
    update(
      key,
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Confirm the brief</h2>
        <p className="mt-1 text-sm text-zinc-700">
          Here&apos;s what the agent extracted from your brief. Edit any value before
          generating — edits become structured signal for the team.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">Extracted brief fields</caption>
          <tbody className="divide-y divide-zinc-100">
            <Row label="Advertiser">
              <input
                className={INPUT}
                value={brief.advertiser}
                onChange={(e) => update("advertiser", e.target.value)}
              />
            </Row>
            <Row label="Vertical">
              <input
                className={INPUT}
                value={brief.vertical}
                onChange={(e) => update("vertical", e.target.value)}
              />
            </Row>
            <Row label="Budget">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  className={`${INPUT} tabular w-40`}
                  value={brief.budgetDollars}
                  onChange={(e) => update("budgetDollars", Number(e.target.value) || 0)}
                />
                <span className="tabular text-xs text-zinc-700">
                  {formatDollars(brief.budgetDollars)} CAD
                </span>
              </div>
            </Row>
            <Row label="Flight">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className={`${INPUT} w-44`}
                  value={brief.flightStart}
                  onChange={(e) => update("flightStart", e.target.value)}
                />
                <span className="text-zinc-500">→</span>
                <input
                  type="date"
                  className={`${INPUT} w-44`}
                  value={brief.flightEnd}
                  onChange={(e) => update("flightEnd", e.target.value)}
                />
              </div>
            </Row>
            <Row label="KPI">
              <select
                className={`${INPUT} w-44`}
                value={brief.kpi}
                onChange={(e) => update("kpi", e.target.value as KPI)}
              >
                {KPIS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Row>
            <Row label="Goal">
              <select
                className={`${INPUT} w-44`}
                value={brief.goal}
                onChange={(e) => update("goal", e.target.value as Goal)}
              >
                {GOALS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Row>
            <Row label="Geo">
              <input
                className={INPUT}
                value={brief.geo.join(", ")}
                onChange={(e) => updateList("geo", e.target.value)}
                placeholder="comma-separated"
              />
            </Row>
            <Row label="Audience">
              <input
                className={INPUT}
                value={brief.audience}
                onChange={(e) => update("audience", e.target.value)}
              />
            </Row>
            <Row label="Inventory">
              <select
                className={`${INPUT} w-44`}
                value={brief.inventoryConstraint}
                onChange={(e) =>
                  update("inventoryConstraint", e.target.value as InventoryConstraint)
                }
              >
                {INVENTORY.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </Row>
            <Row label="Channels in scope">
              <input
                className={INPUT}
                value={brief.channelsInScope.join(", ")}
                onChange={(e) => updateList("channelsInScope", e.target.value)}
                placeholder="comma-separated"
              />
            </Row>
            <Row label="Exclusions">
              <input
                className={INPUT}
                value={brief.exclusions.join(", ")}
                onChange={(e) => updateList("exclusions", e.target.value)}
                placeholder="comma-separated"
              />
            </Row>
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-zinc-700 underline underline-offset-4 hover:text-zinc-900"
        >
          ← Rewrite the brief
        </button>
        <button
          type="button"
          onClick={() => onConfirm(brief)}
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Looks right — generate plan
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th
        scope="row"
        className="w-44 bg-zinc-50 px-4 py-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-zinc-700"
      >
        {label}
      </th>
      <td className="px-4 py-2 align-middle">{children}</td>
    </tr>
  );
}
