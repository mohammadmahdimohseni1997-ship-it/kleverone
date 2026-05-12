import type { Plan } from "./types";

function csvCell(v: string | number): string {
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

export function planToCSV(plan: Plan): string {
  const headers = [
    "Vendor",
    "Type",
    "Channel",
    "Spend %",
    "Spend $",
    "Deal / PMP",
    "Capabilities",
    "Rationale",
    "Allocation rationale",
    "DSP Justification",
  ];
  const rows = plan.lines.map((l) => [
    l.vendor,
    l.vendorType,
    l.channel,
    l.spendPct,
    l.spendDollars,
    l.dealRefs.join("; "),
    l.capabilityIds.join("; "),
    l.rationale,
    l.allocationRationale,
    l.dspJustification ?? "",
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function mdCell(v: string | number): string {
  return String(v).replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

export function planToMarkdown(plan: Plan): string {
  const b = plan.brief;
  const header = [
    `# Draft plan — ${b.advertiser}`,
    "",
    `**Brief:** ${b.vertical} · ${b.kpi} · ${b.goal} · ${b.geo.join(", ")} · ${b.audience} · ${b.inventoryConstraint} inventory · budget ${b.budgetDollars.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })}` +
      (b.exclusions.length > 0 ? ` · excl: ${b.exclusions.join(", ")}` : ""),
    "",
  ];

  const tableHeader =
    "| Vendor | Type | Channel | Spend % | Spend $ | Deal / PMP | Capabilities | Rationale | Allocation rationale | DSP Justification |";
  const tableSep =
    "| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |";
  const tableRows = plan.lines.map(
    (l) =>
      `| ${mdCell(l.vendor)} | ${l.vendorType} | ${mdCell(l.channel)} | ${l.spendPct}% | $${l.spendDollars.toLocaleString()} | ${mdCell(l.dealRefs.join("; "))} | ${mdCell(l.capabilityIds.join("; "))} | ${mdCell(l.rationale)} | ${mdCell(l.allocationRationale)} | ${mdCell(l.dspJustification ?? "")} |`
  );

  const totals = plan.lines.reduce((s, l) => s + l.spendPct, 0);
  const dspShare = plan.lines.filter((l) => l.vendorType === "DSP").reduce((s, l) => s + l.spendPct, 0);

  const footer = [
    "",
    `**Total:** ${totals.toFixed(0)}% · ${plan.totalBudget.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })}`,
    `**DSP share:** ${dspShare.toFixed(0)}%`,
    "",
    `**DSP gate:** ${plan.dspAssessment.summary}`,
  ];
  if (plan.dspAssessment.rejected.length > 0) {
    footer.push("", "**Rejected DSPs:**");
    for (const r of plan.dspAssessment.rejected) {
      footer.push(`- **${r.vendor}:** ${r.rejectedReason}`);
    }
  }

  return [...header, tableHeader, tableSep, ...tableRows, ...footer].join("\n");
}
