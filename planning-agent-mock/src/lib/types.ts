export type KPI = "VCR" | "CTR" | "CPM" | "CPA" | "Viewability" | "Reach";

export type Goal = "awareness" | "consideration" | "performance";

export type InventoryConstraint = "premium" | "open" | "mixed";

export type VendorType = "SSP" | "DSP" | "AdCP";

export type Brief = {
  advertiser: string;
  vertical: string;
  budgetDollars: number;
  flightStart: string;
  flightEnd: string;
  kpi: KPI;
  goal: Goal;
  geo: string[];
  audience: string;
  inventoryConstraint: InventoryConstraint;
  exclusions: string[];
  channelsInScope: string[];
};

export type Capability = {
  id: string;
  name: string;
  description: string;
  channels: string[];
  kpis: KPI[];
  vendorTypes: VendorType[];
  limitations: string;
};

export type PlanLine = {
  id: string;
  vendor: string;
  vendorType: VendorType;
  channel: string;
  spendPct: number;
  spendDollars: number;
  dealRefs: string[];
  capabilityIds: string[];
  rationale: string;
  allocationRationale: string;
  dspJustification: string | null;
};

export type DspEligibleVendor = {
  vendor: string;
  uniqueAccess: string;
  sspCounterfactual: string;
  shareCeiling: number;
  shareCeilingReason: string;
};

export type DspConsideration = {
  vendor: string;
  rejectedReason: string;
};

export type DspAssessment = {
  eligible: DspEligibleVendor[];
  rejected: DspConsideration[];
  summary: string;
};

export type Plan = {
  brief: Brief;
  lines: PlanLine[];
  totalBudget: number;
  generatedAt: string;
  dspAssessment: DspAssessment;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};
