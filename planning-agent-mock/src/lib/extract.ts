import type { Brief, KPI, Goal, InventoryConstraint } from "./types";

const KPI_PATTERNS: Array<[RegExp, KPI]> = [
  [/\b(VCR|video completion rate|completion rate)\b/i, "VCR"],
  [/\b(CTR|click[-\s]?through)\b/i, "CTR"],
  [/\b(CPM)\b/i, "CPM"],
  [/\b(CPA|cost per acquisition|conversions?)\b/i, "CPA"],
  [/\b(viewability|viewable)\b/i, "Viewability"],
  [/\b(reach|unique reach)\b/i, "Reach"],
];

const GOAL_PATTERNS: Array<[RegExp, Goal]> = [
  [/\b(awareness|brand|upper[-\s]funnel)\b/i, "awareness"],
  [/\b(consideration|mid[-\s]funnel|engagement)\b/i, "consideration"],
  [/\b(performance|conversions?|acquisitions?|sales)\b/i, "performance"],
];

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

function isoDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function extractBudget(text: string): number {
  const m = text.match(/\$\s?([\d,.]+)\s?([KkMm])?/);
  if (!m) return 100000;
  const raw = parseFloat(m[1].replace(/,/g, ""));
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") return Math.round(raw * 1000);
  if (suffix === "m") return Math.round(raw * 1_000_000);
  return Math.round(raw);
}

function extractFlight(text: string): { start: string; end: string } {
  const year = new Date().getFullYear();
  const monthRange = text.match(/\b([A-Za-z]+)\s*[-–to]+\s*([A-Za-z]+)\b/);
  if (monthRange) {
    const a = MONTHS[monthRange[1].toLowerCase()];
    const b = MONTHS[monthRange[2].toLowerCase()];
    if (a !== undefined && b !== undefined) {
      const endDay = new Date(year, b + 1, 0).getDate();
      return { start: isoDate(year, a, 1), end: isoDate(year, b, endDay) };
    }
  }
  return { start: isoDate(year, 0, 1), end: isoDate(year, 2, 31) };
}

function extractKPI(text: string): KPI {
  for (const [re, kpi] of KPI_PATTERNS) if (re.test(text)) return kpi;
  return "VCR";
}

function extractGoal(text: string, kpi: KPI): Goal {
  for (const [re, goal] of GOAL_PATTERNS) if (re.test(text)) return goal;
  if (kpi === "VCR" || kpi === "Reach" || kpi === "Viewability") return "awareness";
  if (kpi === "CTR") return "consideration";
  return "performance";
}

function extractGeo(text: string): string[] {
  const geos: string[] = [];
  if (/\bcanada|canadian\b/i.test(text)) geos.push("Canada");
  if (/\bUSA?\b|United States|american\b/i.test(text)) geos.push("USA");
  if (/\bUK|United Kingdom|britain\b/i.test(text)) geos.push("UK");
  return geos.length ? geos : ["Canada"];
}

function extractAudience(text: string): string {
  const ageGender = text.match(/(\d{2})[-–](\d{2})\s*(women|men|adults|people)?/i);
  if (ageGender) {
    const [, lo, hi, g] = ageGender;
    return `${lo}–${hi}${g ? " " + g.toLowerCase() : ""}`;
  }
  if (/\bwomen\b/i.test(text)) return "women";
  if (/\bmen\b/i.test(text)) return "men";
  return "general audience";
}

function extractInventory(text: string): InventoryConstraint {
  if (/\bpremium\b/i.test(text)) return "premium";
  if (/\bopen exchange|scale|broad\b/i.test(text)) return "open";
  return "mixed";
}

function extractExclusions(text: string): string[] {
  const ex: string[] = [];
  if (/\bno UGC|exclude UGC|no user[-\s]generated\b/i.test(text)) ex.push("UGC adjacencies");
  if (/\bbrand[-\s]safe|brand safety\b/i.test(text)) ex.push("brand-unsafe contexts");
  if (/\bno news\b/i.test(text)) ex.push("news adjacencies");
  return ex;
}

function extractChannels(text: string): string[] {
  const ch: string[] = [];
  if (/\bvideo\b/i.test(text)) ch.push("video");
  if (/\bdisplay\b/i.test(text)) ch.push("display");
  if (/\bCTV|connected TV|OTT\b/i.test(text)) ch.push("ctv");
  if (/\byoutube\b/i.test(text)) ch.push("youtube");
  if (ch.length === 0) ch.push("video", "display");
  return ch;
}

function extractAdvertiser(text: string): string {
  const m = text.match(/^([A-Za-z][\w\s&]+?)(?:\s+brand|,)/);
  if (m) return m[1].trim();
  return "Unnamed Advertiser";
}

function extractVertical(text: string): string {
  if (/\bcosmetic|beauty|skincare\b/i.test(text)) return "Cosmetics";
  if (/\bauto|automotive\b/i.test(text)) return "Automotive";
  if (/\bCPG|grocery|food\b/i.test(text)) return "CPG";
  if (/\bretail|ecommerce\b/i.test(text)) return "Retail";
  if (/\bfinance|bank|insurance\b/i.test(text)) return "Finance";
  if (/\btelecom|telco|mobile carrier\b/i.test(text)) return "Telecom";
  return "General";
}

export function extractBrief(text: string): Brief {
  const kpi = extractKPI(text);
  const flight = extractFlight(text);
  return {
    advertiser: extractAdvertiser(text),
    vertical: extractVertical(text),
    budgetDollars: extractBudget(text),
    flightStart: flight.start,
    flightEnd: flight.end,
    kpi,
    goal: extractGoal(text, kpi),
    geo: extractGeo(text),
    audience: extractAudience(text),
    inventoryConstraint: extractInventory(text),
    exclusions: extractExclusions(text),
    channelsInScope: extractChannels(text),
  };
}
