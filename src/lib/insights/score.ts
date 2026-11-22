/**
 * Lead scoring: transparent and rule-based. No model is involved, so every point can be explained to the
 * person looking at the lead. The weights are launch hypotheses (like the plan prices); tune them against
 * real conversion data once a partner has some.
 *
 * Score = intent (30) + timeline (20) + budget (15) + engagement (15) + recency (20) = 100.
 * Leads that must not be contacted (wrong number, do not contact) are excluded, not scored low.
 */

export type ScoreInput = {
  status: string;
  budget: number | null;
  purchase_timeline: string | null;
  source: string | null;
  created_at: string;
  last_interaction_at: string | null;
  next_follow_up_at: string | null;
  /** Number of logged interactions (calls, notes, status changes) in the last 30 days. */
  recent_activity_count: number;
  /** Strongest site-visit state for this lead, if any. */
  visit_status: string | null;
};

export type Band = "hot" | "warm" | "cold" | "low" | "excluded";

export type Reason = { label: string; points: number; max: number };

export type ScoreResult = {
  score: number;
  band: Band;
  reasons: Reason[];
  nextAction: string | null;
};

const DAY = 86_400_000;

/** Months until the buyer plans to purchase, from free text. Null when it cannot be read. */
export function parseTimelineMonths(text: string | null): number | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (!t) return null;
  if (/\b(immediate|immediately|asap|right now|now|urgent|this week|ready to buy)\b/.test(t)) return 0;
  if (/\bthis month\b/.test(t)) return 1;
  if (/\bnext month\b/.test(t)) return 2;
  if (/\b(just (looking|exploring|browsing)|not sure|no plan|exploring|someday|later|future)\b/.test(t)) return null;

  let best: number | null = null;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(week|wk|month|mo|year|yr)s?/g)) {
    const n = Number(m[1]);
    const unit = m[2];
    const months = unit.startsWith("w") ? n / 4.345 : unit.startsWith("m") ? n : n * 12;
    // For ranges like "3-6 months" take the later end, which is the safer reading.
    if (best === null || months > best) best = months;
  }
  return best;
}

const INTENT: Record<string, number> = {
  visit_attended: 30,
  visit_confirmed: 30,
  visit_requested: 28,
  interested: 24,
  callback_requested: 18,
  connected: 12,
  calling: 6,
  queued: 5,
  new: 5,
  not_interested: 0,
};

function timelinePoints(months: number | null): { points: number; label: string } {
  if (months === null) return { points: 3, label: "Timeline not known" };
  if (months <= 1) return { points: 20, label: "Buying within a month" };
  if (months <= 3) return { points: 16, label: "Buying within 3 months" };
  if (months <= 6) return { points: 11, label: "Buying within 6 months" };
  if (months <= 12) return { points: 6, label: "Buying within a year" };
  return { points: 2, label: "Buying after a year" };
}

export function scoreLead(l: ScoreInput, now: Date = new Date()): ScoreResult {
  if (l.status === "wrong_number" || l.status === "do_not_contact") {
    return { score: 0, band: "excluded", reasons: [], nextAction: null };
  }

  const reasons: Reason[] = [];

  const intent = INTENT[l.status] ?? 5;
  reasons.push({ label: `Status: ${l.status.replace(/_/g, " ")}`, points: intent, max: 30 });

  const tl = timelinePoints(parseTimelineMonths(l.purchase_timeline));
  reasons.push({ label: tl.label, points: tl.points, max: 20 });

  const budgetPts = l.budget && l.budget > 0 ? 15 : 0;
  reasons.push({ label: budgetPts ? "Budget stated" : "Budget not captured", points: budgetPts, max: 15 });

  let engagement = 0;
  let engagementLabel = "No engagement yet";
  if (l.visit_status && ["requested", "pending_confirmation", "confirmed", "attended"].includes(l.visit_status)) {
    engagement = 15;
    engagementLabel = "Site visit in progress";
  } else if (l.recent_activity_count >= 3) {
    engagement = 10;
    engagementLabel = "Active conversation (3+ interactions in 30 days)";
  } else if (l.recent_activity_count >= 1) {
    engagement = 6;
    engagementLabel = "Some engagement in the last 30 days";
  }
  reasons.push({ label: engagementLabel, points: engagement, max: 15 });

  const lastTouch = l.last_interaction_at ? new Date(l.last_interaction_at) : null;
  const daysSinceTouch = lastTouch ? (now.getTime() - lastTouch.getTime()) / DAY : null;
  const daysSinceCreated = (now.getTime() - new Date(l.created_at).getTime()) / DAY;
  let recency = 0;
  let recencyLabel = "Not contacted in over a month";
  if (daysSinceTouch === null) {
    // Never contacted: a fresh lead is worth acting on today, an old untouched one has gone cold.
    if (daysSinceCreated <= 2) { recency = 14; recencyLabel = "New lead, not yet contacted"; }
    else if (daysSinceCreated <= 7) { recency = 8; recencyLabel = "Not contacted yet (under a week old)"; }
    else { recency = 0; recencyLabel = "Never contacted and over a week old"; }
  } else if (daysSinceTouch <= 2) { recency = 20; recencyLabel = "Contacted in the last 2 days"; }
  else if (daysSinceTouch <= 7) { recency = 14; recencyLabel = "Contacted in the last week"; }
  else if (daysSinceTouch <= 14) { recency = 8; recencyLabel = "Contacted in the last 2 weeks"; }
  else if (daysSinceTouch <= 30) { recency = 3; recencyLabel = "Last contacted 2–4 weeks ago"; }
  reasons.push({ label: recencyLabel, points: recency, max: 20 });

  let score = reasons.reduce((n, r) => n + r.points, 0);
  // A lead that said no is never "hot", whatever else is true of it.
  if (l.status === "not_interested") score = Math.min(score, 15);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const band: Band = score >= 70 ? "hot" : score >= 45 ? "warm" : score >= 20 ? "cold" : "low";

  return { score, band, reasons, nextAction: nextAction(l, band, daysSinceTouch, now) };
}

function nextAction(l: ScoreInput, band: Band, daysSinceTouch: number | null, now: Date): string | null {
  if (l.status === "not_interested" || l.status === "visit_attended") return null;
  if (l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now.getTime()) {
    const days = Math.max(1, Math.floor((now.getTime() - new Date(l.next_follow_up_at).getTime()) / DAY));
    return days <= 1 ? "Follow-up is due: contact today" : `Follow-up overdue by ${days} days`;
  }
  if (l.visit_status === "requested" || l.visit_status === "pending_confirmation") return "Confirm the site-visit slot";
  if (l.visit_status === "confirmed") return "Send a visit reminder";
  if (l.status === "new" && daysSinceTouch === null) return "Make first contact";
  if (!l.budget || !l.purchase_timeline) {
    if (band === "hot" || band === "warm") return "Capture budget and timeline";
  }
  if ((band === "hot" || band === "warm") && !l.visit_status) return "Offer a site visit";
  if (!l.next_follow_up_at && ["interested", "callback_requested", "connected"].includes(l.status)) return "Schedule a follow-up";
  if (daysSinceTouch !== null && daysSinceTouch > 14) return "Re-engage: no contact in 2+ weeks";
  return null;
}

export const BAND_LABEL: Record<Band, string> = { hot: "Hot", warm: "Warm", cold: "Cold", low: "Low", excluded: "Excluded" };
export const BAND_TONE: Record<Band, "green" | "amber" | "blue" | "slate" | "red"> = {
  hot: "green", warm: "amber", cold: "blue", low: "slate", excluded: "red",
};
