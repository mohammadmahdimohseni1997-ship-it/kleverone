import type { Plan, ValidationResult } from "./types";
import { capabilityIdsExist } from "./catalog";

export function validatePlan(plan: Plan): ValidationResult {
  const errors: string[] = [];

  const totalPct = plan.lines.reduce((s, l) => s + l.spendPct, 0);
  if (Math.abs(totalPct - 100) > 0.5) {
    errors.push(`Spend percentages sum to ${totalPct.toFixed(1)}%, expected 100%.`);
  }

  for (const line of plan.lines) {
    if (!capabilityIdsExist(line.capabilityIds)) {
      errors.push(`Line "${line.vendor}" references unknown capability IDs: ${line.capabilityIds.join(", ")}.`);
    }
    if (line.vendorType === "DSP" && !line.dspJustification) {
      errors.push(`DSP line "${line.vendor}" is missing a justification.`);
    }
    if (line.vendorType !== "DSP" && line.dspJustification) {
      errors.push(`Non-DSP line "${line.vendor}" should not carry a DSP justification.`);
    }
    if (line.spendPct < 0 || line.spendPct > 100) {
      errors.push(`Line "${line.vendor}" has invalid spend percentage: ${line.spendPct}.`);
    }
  }

  const dspShare = plan.lines
    .filter((l) => l.vendorType === "DSP")
    .reduce((s, l) => s + l.spendPct, 0);
  const youtubeInScope = plan.brief.channelsInScope.includes("youtube");
  if (!youtubeInScope && dspShare > 25 && plan.brief.goal !== "performance") {
    errors.push(`DSP share is ${dspShare.toFixed(0)}% on a non-performance brief without YouTube in scope; SSP-direct should be the default.`);
  }

  return { ok: errors.length === 0, errors };
}
