import type {
  Brief,
  DspAssessment,
  DspConsideration,
  DspEligibleVendor,
  Plan,
  PlanLine,
} from "./types";

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dollarsFromPct(budget: number, pct: number): number {
  return Math.round(budget * (pct / 100));
}

function composeDspJustification(v: DspEligibleVendor): string {
  return `${v.uniqueAccess}. ${v.sspCounterfactual} Share capped at ${v.shareCeiling}% — ${v.shareCeilingReason}`;
}

export function assessDspGate(brief: Brief): DspAssessment {
  const eligible: DspEligibleVendor[] = [];
  const rejected: DspConsideration[] = [];

  const youtubeInScope = brief.channelsInScope.includes("youtube");
  const hasRetargetingPool = /retarget/i.test(brief.audience);
  const retailPerformance = brief.vertical === "Retail" && brief.goal === "performance";
  const budgetSupportsYouTube = brief.budgetDollars >= 100_000;

  if (youtubeInScope && budgetSupportsYouTube) {
    eligible.push({
      vendor: "DV360",
      uniqueAccess:
        "DV360 is the only path to YouTube at scale — PubMatic, Equativ, Magnite, and AdCP do not transact Google-owned video inventory",
      sspCounterfactual:
        brief.goal === "awareness"
          ? "SSP-direct on Bell/Corus VOD and AdCP publisher-direct cover Canadian broadcaster premium video, but cannot reach YouTube audience time — the 25–54 segment indexes high on YouTube in time-spent that broadcaster VOD does not capture."
          : "SSP-direct cannot access YouTube's logged-in audience signal, which is the differentiated layer for this KPI.",
      shareCeiling: 10,
      shareCeilingReason:
        brief.goal === "awareness"
          ? "TrueView VCR rates trail Equativ broadcaster VOD on the same audience, so the SSP-direct path earns the majority of video budget on cost-per-completion. Above 10% the line buys incremental reach at a worse VCR rate than the brief warrants."
          : "YouTube's performance signal for this KPI is weaker than the existing SSP/AdCP paths; above 10% the budget is better placed in SSP-direct.",
    });
  } else if (youtubeInScope && !budgetSupportsYouTube) {
    rejected.push({
      vendor: "DV360",
      rejectedReason:
        "YouTube is in scope, but the brief's budget is below the threshold for YouTube to deliver meaningful incremental reach against premium VOD — the fixed minimums (TrueView, frequency, audience reach) leave the line under-delivered.",
    });
  } else {
    rejected.push({
      vendor: "DV360",
      rejectedReason:
        "YouTube is not in scope. DV360's unique value is YouTube inventory access; without it, the bidding and audience layer it adds is matched or beaten by SSP-direct on the same Canadian premium supply.",
    });
  }

  if (hasRetargetingPool && brief.goal === "performance") {
    eligible.push({
      vendor: "The Trade Desk",
      uniqueAccess:
        "TTD holds the active retargeting pool with the brief's existing recency window",
      sspCounterfactual:
        "SSP-direct can prospect against contextual and Canadian publisher data, and AdCP can hit premium publisher inventory, but the resident retargeting pool cannot be reconstructed on SSP paths without multi-week recency recapture — and the highest-intent users would age out during that gap.",
      shareCeiling: 25,
      shareCeilingReason:
        "Pool size caps the deliverable retargeting impressions; incremental budget above 25% would route to TTD's open-exchange supply where SSP-direct wins on margin, frequency control via the ad server, and supply-path transparency.",
    });
  } else if (brief.goal === "performance" && !hasRetargetingPool) {
    rejected.push({
      vendor: "The Trade Desk",
      rejectedReason:
        "No retargeting pool referenced in the brief. TTD's differentiated value for performance is the resident audience pool; without it, TTD's bidding optimization on open-exchange supply offers no measurable advantage over SSP-direct curated deals on the same inventory at higher cost.",
    });
  }

  if (retailPerformance) {
    eligible.push({
      vendor: "Amazon DSP",
      uniqueAccess:
        "Amazon retail shopper segments — in-Amazon purchase intent, category browse, brand affinity from on-Amazon behavior — resolve only inside Amazon DSP",
      sspCounterfactual:
        "SSP-direct can match contextual retail signal and Canadian publisher coverage; the behavioral retail signal from on-Amazon activity does not exist outside Amazon DSP, and is the differentiated layer for retail performance.",
      shareCeiling: 25,
      shareCeilingReason:
        "Budget is concentrated on Amazon owned-and-operated placements and endemic retail context where the audience data has leverage. Above 25% the line spills into Amazon DSP's open-web supply, which delivers no better than SSP-direct on the same inventory at higher cost.",
    });
  } else if (brief.vertical === "Retail" && brief.goal !== "performance") {
    rejected.push({
      vendor: "Amazon DSP",
      rejectedReason:
        "Retail vertical but not a performance brief. Amazon's behavioral retail data is differentiated for lower-funnel; on awareness/consideration KPIs the SSP-direct premium video path delivers stronger VCR and reach at lower cost.",
    });
  }

  const summary =
    eligible.length === 0
      ? "DSPs considered and rejected: none of DV360, The Trade Desk, or Amazon DSP carry a capability unavailable on SSP-direct or AdCP for this brief. SSP-direct and publisher-direct cover the inventory, KPI, audience, and constraint requirements without paying DSP margin overhead, supply-path opacity, or frequency-capping fragmentation."
      : `${eligible.length} DSP${eligible.length > 1 ? "s" : ""} earned a seat on this plan (${eligible
          .map((e) => e.vendor)
          .join(", ")}); each is gated by a capability SSP-direct and AdCP cannot match, and capped at the share where that unique value runs out.`;

  return { eligible, rejected, summary };
}

function premiumAwarenessPlan(brief: Brief, gate: DspAssessment): PlanLine[] {
  const budget = brief.budgetDollars;
  const lines: PlanLine[] = [];
  const dv360 = gate.eligible.find((e) => e.vendor === "DV360");

  if (dv360) {
    const pmShare = 35;
    const eqShare = 30;
    const adcpShare = 25;
    const dvShare = dv360.shareCeiling;

    lines.push({
      id: newId(),
      vendor: "PubMatic",
      vendorType: "SSP",
      channel: "video",
      spendPct: pmShare,
      spendDollars: dollarsFromPct(budget, pmShare),
      dealRefs: ["PM-CA-PREM-VID-0421", "PM-CA-CTV-0118"],
      capabilityIds: [
        "pubmatic-premium-video",
        "video-completion-optimization",
        "contextual-exclusion",
      ],
      rationale: `Premium Canadian video deals tied to ${brief.kpi}; contextual exclusion enforces the no-UGC constraint at pre-bid.`,
      allocationRationale: `Largest line at ${pmShare}% — PubMatic's deal coverage on Canadian premium video is the broadest in the plan, so the biggest share anchors cost-per-completion delivery. Sized down from a 40% no-DSP baseline to make room for the ${dvShare}% DV360 line.`,
      dspJustification: null,
    });
    lines.push({
      id: newId(),
      vendor: "Equativ",
      vendorType: "SSP",
      channel: "video",
      spendPct: eqShare,
      spendDollars: dollarsFromPct(budget, eqShare),
      dealRefs: ["EQ-BCE-VOD-3301", "EQ-CORUS-VID-2204"],
      capabilityIds: ["equativ-premium-video", "video-completion-optimization"],
      rationale: `Equativ broadcaster deals on Bell and Corus VOD against ${brief.audience}; the strongest VCR rate in the plan.`,
      allocationRationale: `Second-largest line at ${eqShare}%. Broadcaster VOD has the strongest VCR but availability is windowed by publisher schedules — concentrating more here risks under-delivery on flight pacing.`,
      dspJustification: null,
    });
    lines.push({
      id: newId(),
      vendor: "Publisher-Direct (AdCP)",
      vendorType: "AdCP",
      channel: "video",
      spendPct: adcpShare,
      spendDollars: dollarsFromPct(budget, adcpShare),
      dealRefs: ["CBC-PREM-VID-0512", "GLOBE-VID-4408"],
      capabilityIds: ["adcp-publisher-direct", "canadian-publisher-deals"],
      rationale: `Publisher-direct premium video on Canadian-owned outlets (CBC, Globe); editorial-premium context with brand safety by default.`,
      allocationRationale: `${adcpShare}% keeps AdCP a meaningful third path. Ceiling set by per-outlet inventory caps on Canadian-owned publishers — going higher would require additional publisher relationships not currently activated.`,
      dspJustification: null,
    });
    lines.push({
      id: newId(),
      vendor: "DV360",
      vendorType: "DSP",
      channel: "youtube",
      spendPct: dvShare,
      spendDollars: dollarsFromPct(budget, dvShare),
      dealRefs: ["YT-TRUEVIEW-CA"],
      capabilityIds: ["dv360-youtube"],
      rationale: `TrueView in-stream on YouTube against ${brief.audience}; incremental audience time the broadcaster path does not capture.`,
      allocationRationale: `At the model's ${dvShare}% ceiling — see DSP justification for the full share rationale.`,
      dspJustification: composeDspJustification(dv360),
    });
  } else {
    const pmShare = 40;
    const eqShare = 30;
    const mgShare = 15;
    const adcpShare = 15;

    lines.push({
      id: newId(),
      vendor: "PubMatic",
      vendorType: "SSP",
      channel: "video",
      spendPct: pmShare,
      spendDollars: dollarsFromPct(budget, pmShare),
      dealRefs: ["PM-CA-PREM-VID-0421", "PM-CA-CTV-0118"],
      capabilityIds: [
        "pubmatic-premium-video",
        "video-completion-optimization",
        "contextual-exclusion",
      ],
      rationale: `Premium Canadian video deals tied to ${brief.kpi}; contextual exclusion enforces the no-UGC constraint at pre-bid.`,
      allocationRationale: `Primary cost-per-completion path at ${pmShare}%. PubMatic's deal coverage on Canadian premium video is the broadest, so the largest share anchors video delivery against the KPI.`,
      dspJustification: null,
    });
    lines.push({
      id: newId(),
      vendor: "Equativ",
      vendorType: "SSP",
      channel: "video",
      spendPct: eqShare,
      spendDollars: dollarsFromPct(budget, eqShare),
      dealRefs: ["EQ-BCE-VOD-3301", "EQ-CORUS-VID-2204"],
      capabilityIds: ["equativ-premium-video", "video-completion-optimization"],
      rationale: `Equativ broadcaster deals on Bell and Corus VOD against ${brief.audience}; strongest VCR rate in the plan.`,
      allocationRationale: `${eqShare}% sits below PubMatic — broadcaster VOD has the strongest VCR but availability is windowed by publisher schedules, so concentrating more here risks pacing issues.`,
      dspJustification: null,
    });
    lines.push({
      id: newId(),
      vendor: "Magnite",
      vendorType: "SSP",
      channel: "ctv",
      spendPct: mgShare,
      spendDollars: dollarsFromPct(budget, mgShare),
      dealRefs: ["MG-CTV-CA-2208"],
      capabilityIds: ["magnite-ctv-deals", "video-completion-optimization"],
      rationale: `Magnite CTV deals extend reach into streaming households; same KPI-optimization stack as the video lines.`,
      allocationRationale: `${mgShare}% adds a CTV layer that's incremental to the SSP video path and supports cross-screen frequency-cap spread. Capped because CTV CPMs run higher than VOD on the same VCR target.`,
      dspJustification: null,
    });
    lines.push({
      id: newId(),
      vendor: "Publisher-Direct (AdCP)",
      vendorType: "AdCP",
      channel: "video",
      spendPct: adcpShare,
      spendDollars: dollarsFromPct(budget, adcpShare),
      dealRefs: ["CBC-PREM-VID-0512", "GLOBE-VID-4408"],
      capabilityIds: ["adcp-publisher-direct", "canadian-publisher-deals"],
      rationale: `Publisher-direct premium video on Canadian-owned outlets (CBC, Globe); editorial-premium context and brand safety by default.`,
      allocationRationale: `${adcpShare}% sized for editorial-premium complement. Capped by per-outlet inventory ceilings on Canadian-owned publishers.`,
      dspJustification: null,
    });
  }
  return lines;
}

function performancePlan(brief: Brief, gate: DspAssessment): PlanLine[] {
  const budget = brief.budgetDollars;
  const lines: PlanLine[] = [];
  const ttd = gate.eligible.find((e) => e.vendor === "The Trade Desk");
  const amzn = gate.eligible.find((e) => e.vendor === "Amazon DSP");

  let sspShare = 75;
  if (ttd) sspShare -= ttd.shareCeiling;
  if (amzn) sspShare -= amzn.shareCeiling;

  const pmShare = Math.round(sspShare * 0.5);
  const ixShare = Math.round(sspShare * 0.35);
  const adcpRemainder = sspShare - pmShare - ixShare;
  const adcpShare = adcpRemainder + 25;

  lines.push({
    id: newId(),
    vendor: "PubMatic",
    vendorType: "SSP",
    channel: "display",
    spendPct: pmShare,
    spendDollars: dollarsFromPct(budget, pmShare),
    dealRefs: ["PM-CA-PERF-DSP-0822"],
    capabilityIds: ["pubmatic-premium-video", "contextual-exclusion", "brand-safety-prebid"],
    rationale: `SSP-direct display on PubMatic delivers efficient ${brief.kpi} on brand-safe inventory; primary prospecting path.`,
    allocationRationale: `Largest SSP-direct line at ${pmShare}%. PubMatic's display deal coverage is broadest and pre-bid brand safety is strongest, so the biggest share anchors prospecting volume.`,
    dspJustification: null,
  });
  lines.push({
    id: newId(),
    vendor: "Index Exchange",
    vendorType: "SSP",
    channel: "display",
    spendPct: ixShare,
    spendDollars: dollarsFromPct(budget, ixShare),
    dealRefs: ["IX-CA-PMP-1109"],
    capabilityIds: ["ix-private-deals", "contextual-exclusion"],
    rationale: `IX private deals add display reach across mid-tier publishers at ${brief.kpi}-efficient CPMs; secondary SSP path.`,
    allocationRationale: `${ixShare}% sits below PubMatic — IX inventory skews mid-tier, but the share materially diversifies SSP supply and frequency-cap exposure.`,
    dspJustification: null,
  });
  lines.push({
    id: newId(),
    vendor: "Publisher-Direct (AdCP)",
    vendorType: "AdCP",
    channel: "display",
    spendPct: adcpShare,
    spendDollars: dollarsFromPct(budget, adcpShare),
    dealRefs: ["GLOBE-DSP-PRM-2208"],
    capabilityIds: ["adcp-publisher-direct", "canadian-publisher-deals"],
    rationale: `Publisher-direct display on premium Canadian outlets; above-the-fold viewability and editorial brand safety by default.`,
    allocationRationale: `${adcpShare}% keeps AdCP a meaningful third path on a performance plan; premium-outlet placement supports brand-safe lower-funnel signal.`,
    dspJustification: null,
  });

  if (ttd) {
    lines.push({
      id: newId(),
      vendor: "The Trade Desk",
      vendorType: "DSP",
      channel: "display",
      spendPct: ttd.shareCeiling,
      spendDollars: dollarsFromPct(budget, ttd.shareCeiling),
      dealRefs: ["TTD-RTG-POOL-V3"],
      capabilityIds: ["ttd-retargeting"],
      rationale: `Retargeting against the resident TTD pool drives lower-funnel ${brief.kpi}; the highest-intent recency window.`,
      allocationRationale: `At the model's ${ttd.shareCeiling}% ceiling — see DSP justification for the full share rationale.`,
      dspJustification: composeDspJustification(ttd),
    });
  }
  if (amzn) {
    lines.push({
      id: newId(),
      vendor: "Amazon DSP",
      vendorType: "DSP",
      channel: "display",
      spendPct: amzn.shareCeiling,
      spendDollars: dollarsFromPct(budget, amzn.shareCeiling),
      dealRefs: ["AMZ-RETAIL-CA-1188"],
      capabilityIds: ["amazon-dsp-retail"],
      rationale: `Amazon retail shopper segments against ${brief.audience}; concentrated on Amazon O&O and endemic retail context.`,
      allocationRationale: `At the model's ${amzn.shareCeiling}% ceiling — see DSP justification for the full share rationale.`,
      dspJustification: composeDspJustification(amzn),
    });
  }
  return lines;
}

export function generatePlan(brief: Brief): Plan {
  const dspAssessment = assessDspGate(brief);
  const lines =
    brief.goal === "performance" || brief.kpi === "CTR" || brief.kpi === "CPA"
      ? performancePlan(brief, dspAssessment)
      : premiumAwarenessPlan(brief, dspAssessment);

  const total = lines.reduce((s, l) => s + l.spendDollars, 0);
  return {
    brief,
    lines,
    totalBudget: total,
    generatedAt: new Date().toISOString(),
    dspAssessment,
  };
}

export function recomputePlanTotals(plan: Plan): Plan {
  const budget = plan.brief.budgetDollars;
  const lines = plan.lines.map((l) => ({
    ...l,
    spendDollars: dollarsFromPct(budget, l.spendPct),
    spendPct: round2(l.spendPct),
  }));
  return {
    ...plan,
    lines,
    totalBudget: lines.reduce((s, l) => s + l.spendDollars, 0),
  };
}
