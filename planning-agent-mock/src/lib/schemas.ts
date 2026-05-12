import { z } from "zod";

export const kpiSchema = z.enum([
  "VCR",
  "CTR",
  "CPM",
  "CPA",
  "Viewability",
  "Reach",
]);

export const goalSchema = z.enum(["awareness", "consideration", "performance"]);
export const inventorySchema = z.enum(["premium", "open", "mixed"]);
export const vendorTypeSchema = z.enum(["SSP", "DSP", "AdCP"]);

export const briefSchema = z.object({
  advertiser: z.string().min(1),
  vertical: z.string().min(1),
  budgetDollars: z.number().int().positive(),
  flightStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  flightEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kpi: kpiSchema,
  goal: goalSchema,
  geo: z.array(z.string()).min(1),
  audience: z.string().min(1),
  inventoryConstraint: inventorySchema,
  exclusions: z.array(z.string()),
  channelsInScope: z.array(z.string()).min(1),
});

export const planLineLLMSchema = z.object({
  vendor: z.string().min(1),
  vendorType: vendorTypeSchema,
  channel: z.string().min(1),
  spendPct: z.number().min(0).max(100),
  dealRefs: z.array(z.string()),
  capabilityIds: z.array(z.string()),
  rationale: z.string().min(1),
  allocationRationale: z.string().min(1),
  dspJustification: z.string().nullable(),
});

export const planLLMSchema = z.object({
  lines: z.array(planLineLLMSchema).min(1),
});

export type BriefInput = z.infer<typeof briefSchema>;
export type PlanLineLLM = z.infer<typeof planLineLLMSchema>;
export type PlanLLM = z.infer<typeof planLLMSchema>;
