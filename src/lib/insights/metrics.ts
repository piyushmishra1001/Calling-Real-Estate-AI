import { scoreLead, type Band, type ScoreInput, type ScoreResult } from "./score";

export type LeadRow = ScoreInput & {
  id: string;
  name: string;
  project_id: string;
  assigned_to: string | null;
};

export type Scored = LeadRow & { result: ScoreResult };

export const FUNNEL: { key: string; label: string; statuses: string[] }[] = [
  { key: "captured", label: "Captured", statuses: [] },
  { key: "contacted", label: "Contacted", statuses: ["connected", "interested", "callback_requested", "visit_requested", "visit_confirmed", "visit_attended", "not_interested"] },
  { key: "interested", label: "Interested", statuses: ["interested", "callback_requested", "visit_requested", "visit_confirmed", "visit_attended"] },
  { key: "visit", label: "Visit requested or booked", statuses: ["visit_requested", "visit_confirmed", "visit_attended"] },
  { key: "attended", label: "Visit attended", statuses: ["visit_attended"] },
];

export type Insights = {
  total: number;
  scored: Scored[];
  bands: Record<Band, number>;
  funnel: { key: string; label: string; count: number; pctOfCaptured: number; pctOfPrev: number | null }[];
  hot: Scored[];
  needsAttention: Scored[];
  bySource: { source: string; leads: number; interested: number; visits: number; interestedPct: number }[];
  byProject: { projectId: string; leads: number; hot: number; visits: number }[];
  byOwner: { ownerId: string | null; leads: number; hot: number; overdue: number; avgScore: number }[];
  overdueFollowUps: number;
  untouchedNew: number;
  missingBudgetOrTimeline: number;
};

export function buildInsights(rows: LeadRow[], now: Date = new Date()): Insights {
  const scored: Scored[] = rows.map((r) => ({ ...r, result: scoreLead(r, now) }));
  const live = scored.filter((s) => s.result.band !== "excluded");

  const bands: Record<Band, number> = { hot: 0, warm: 0, cold: 0, low: 0, excluded: 0 };
  for (const s of scored) bands[s.result.band]++;

  const captured = live.length;
  const counts = FUNNEL.map((f) => (f.statuses.length === 0 ? captured : live.filter((s) => f.statuses.includes(s.status)).length));
  const funnel = FUNNEL.map((f, i) => ({
    key: f.key,
    label: f.label,
    count: counts[i],
    pctOfCaptured: captured > 0 ? (counts[i] / captured) * 100 : 0,
    pctOfPrev: i === 0 ? null : counts[i - 1] > 0 ? (counts[i] / counts[i - 1]) * 100 : null,
  }));

  const byScoreDesc = (a: Scored, b: Scored) => b.result.score - a.result.score;
  const hot = live.filter((s) => s.result.band === "hot").sort(byScoreDesc).slice(0, 10);

  const needsAttention = live
    .filter((s) => s.result.nextAction && (s.result.band === "hot" || s.result.band === "warm"))
    .sort(byScoreDesc)
    .slice(0, 10);

  const sourceMap = new Map<string, { leads: number; interested: number; visits: number }>();
  for (const s of live) {
    const key = (s.source ?? "").trim() || "Unknown";
    const e = sourceMap.get(key) ?? { leads: 0, interested: 0, visits: 0 };
    e.leads++;
    if (FUNNEL[2].statuses.includes(s.status)) e.interested++;
    if (FUNNEL[3].statuses.includes(s.status)) e.visits++;
    sourceMap.set(key, e);
  }
  const bySource = [...sourceMap.entries()]
    .map(([source, e]) => ({ source, ...e, interestedPct: e.leads > 0 ? (e.interested / e.leads) * 100 : 0 }))
    .sort((a, b) => b.leads - a.leads);

  const projMap = new Map<string, { leads: number; hot: number; visits: number }>();
  for (const s of live) {
    const e = projMap.get(s.project_id) ?? { leads: 0, hot: 0, visits: 0 };
    e.leads++;
    if (s.result.band === "hot") e.hot++;
    if (FUNNEL[3].statuses.includes(s.status)) e.visits++;
    projMap.set(s.project_id, e);
  }
  const byProject = [...projMap.entries()].map(([projectId, e]) => ({ projectId, ...e })).sort((a, b) => b.leads - a.leads);

  const isOverdue = (s: Scored) => !!s.next_follow_up_at && new Date(s.next_follow_up_at).getTime() < now.getTime() && !["not_interested", "visit_attended"].includes(s.status);
  const ownerMap = new Map<string | null, { leads: number; hot: number; overdue: number; total: number }>();
  for (const s of live) {
    const e = ownerMap.get(s.assigned_to) ?? { leads: 0, hot: 0, overdue: 0, total: 0 };
    e.leads++;
    e.total += s.result.score;
    if (s.result.band === "hot") e.hot++;
    if (isOverdue(s)) e.overdue++;
    ownerMap.set(s.assigned_to, e);
  }
  const byOwner = [...ownerMap.entries()]
    .map(([ownerId, e]) => ({ ownerId, leads: e.leads, hot: e.hot, overdue: e.overdue, avgScore: e.leads > 0 ? Math.round(e.total / e.leads) : 0 }))
    .sort((a, b) => b.leads - a.leads);

  return {
    total: rows.length,
    scored,
    bands,
    funnel,
    hot,
    needsAttention,
    bySource,
    byProject,
    byOwner,
    overdueFollowUps: live.filter(isOverdue).length,
    untouchedNew: live.filter((s) => s.status === "new" && !s.last_interaction_at).length,
    missingBudgetOrTimeline: live.filter((s) => !s.budget || !s.purchase_timeline).length,
  };
}
