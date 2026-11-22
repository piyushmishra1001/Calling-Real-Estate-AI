import { describe, expect, it } from "vitest";
import { parseTimelineMonths, scoreLead, type ScoreInput } from "@/lib/insights/score";
import { buildInsights, type LeadRow } from "@/lib/insights/metrics";

const NOW = new Date("2026-11-22T06:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const base: ScoreInput = {
  status: "new", budget: null, purchase_timeline: null, source: null,
  created_at: daysAgo(1), last_interaction_at: null, next_follow_up_at: null,
  recent_activity_count: 0, visit_status: null,
};

describe("parseTimelineMonths", () => {
  it.each([
    ["immediately", 0], ["ASAP", 0], ["this month", 1], ["next month", 2],
    ["2 months", 2], ["within 3 months", 3], ["3-6 months", 6], ["1 year", 12], ["6 weeks", 6 / 4.345 * 1],
  ])("%s", (text, expected) => {
    expect(parseTimelineMonths(text)).toBeCloseTo(expected as number, 1);
  });
  it.each([[null], [""], ["just exploring"], ["not sure yet"]])("unreadable: %s", (t) => {
    expect(parseTimelineMonths(t as string | null)).toBeNull();
  });
});

describe("scoreLead", () => {
  it("scores a strong lead as hot, with reasons that add up to the score", () => {
    const r = scoreLead({ ...base, status: "visit_requested", budget: 9_000_000, purchase_timeline: "1 month", last_interaction_at: daysAgo(1), recent_activity_count: 4, visit_status: "requested" }, NOW);
    expect(r.band).toBe("hot");
    expect(r.reasons.reduce((n, x) => n + x.points, 0)).toBe(r.score);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("scores an old, untouched lead low", () => {
    const r = scoreLead({ ...base, created_at: daysAgo(40) }, NOW);
    expect(r.band).toBe("low");
  });

  it("never lets a lead that said no be warm or hot", () => {
    const r = scoreLead({ ...base, status: "not_interested", budget: 9_000_000, purchase_timeline: "now", last_interaction_at: daysAgo(0), recent_activity_count: 9 }, NOW);
    expect(r.score).toBeLessThanOrEqual(15);
    expect(["cold", "low"]).toContain(r.band);
    expect(r.nextAction).toBeNull();
  });

  it.each(["wrong_number", "do_not_contact"])("excludes %s from scoring and actions", (status) => {
    const r = scoreLead({ ...base, status }, NOW);
    expect(r.band).toBe("excluded");
    expect(r.score).toBe(0);
    expect(r.nextAction).toBeNull();
  });

  it("rewards a nearer timeline", () => {
    const soon = scoreLead({ ...base, purchase_timeline: "this month" }, NOW).score;
    const later = scoreLead({ ...base, purchase_timeline: "18 months" }, NOW).score;
    expect(soon).toBeGreaterThan(later);
  });

  it("suggests the right next action", () => {
    expect(scoreLead(base, NOW).nextAction).toBe("Make first contact");
    expect(scoreLead({ ...base, status: "interested", last_interaction_at: daysAgo(1), next_follow_up_at: daysAgo(3), budget: 1, purchase_timeline: "2 months" }, NOW).nextAction).toBe("Follow-up overdue by 3 days");
    expect(scoreLead({ ...base, status: "interested", last_interaction_at: daysAgo(1), visit_status: "requested", budget: 1, purchase_timeline: "2 months" }, NOW).nextAction).toBe("Confirm the site-visit slot");
    expect(scoreLead({ ...base, status: "interested", last_interaction_at: daysAgo(1), budget: 1, purchase_timeline: "1 month", next_follow_up_at: daysAgo(-2), recent_activity_count: 3 }, NOW).nextAction).toBe("Offer a site visit");
  });

  it("is always within 0..100", () => {
    for (const status of ["new", "interested", "visit_attended", "not_interested", "connected"]) {
      const r = scoreLead({ ...base, status, budget: 1, purchase_timeline: "now", last_interaction_at: daysAgo(0), recent_activity_count: 99, visit_status: "attended" }, NOW);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("buildInsights", () => {
  const row = (o: Partial<LeadRow> & { id: string }): LeadRow => ({ ...base, name: o.id, project_id: "p1", assigned_to: "u1", ...o });

  it("builds a funnel from statuses, leaving excluded leads out", () => {
    const rows = [
      row({ id: "a", status: "new" }),
      row({ id: "b", status: "connected", last_interaction_at: daysAgo(1) }),
      row({ id: "c", status: "interested", last_interaction_at: daysAgo(1) }),
      row({ id: "d", status: "visit_confirmed", last_interaction_at: daysAgo(1) }),
      row({ id: "e", status: "visit_attended", last_interaction_at: daysAgo(1) }),
      row({ id: "f", status: "wrong_number" }),
    ];
    const i = buildInsights(rows, NOW);
    const counts = Object.fromEntries(i.funnel.map((f) => [f.key, f.count]));
    expect(counts).toEqual({ captured: 5, contacted: 4, interested: 3, visit: 2, attended: 1 });
    expect(i.bands.excluded).toBe(1);
    expect(i.total).toBe(6);
  });

  it("groups sources, treating blank as Unknown", () => {
    const i = buildInsights([
      row({ id: "a", source: "99acres", status: "interested", last_interaction_at: daysAgo(1) }),
      row({ id: "b", source: "99acres" }),
      row({ id: "c", source: null }),
    ], NOW);
    const s = Object.fromEntries(i.bySource.map((x) => [x.source, x]));
    expect(s["99acres"].leads).toBe(2);
    expect(s["99acres"].interestedPct).toBe(50);
    expect(s["Unknown"].leads).toBe(1);
  });

  it("counts overdue follow-ups and untouched new leads", () => {
    const i = buildInsights([
      row({ id: "a", status: "interested", next_follow_up_at: daysAgo(2), last_interaction_at: daysAgo(3) }),
      row({ id: "b", status: "new" }),
      row({ id: "c", status: "not_interested", next_follow_up_at: daysAgo(2) }),
    ], NOW);
    expect(i.overdueFollowUps).toBe(1);
    expect(i.untouchedNew).toBe(1);
  });

  it("handles an empty list", () => {
    const i = buildInsights([], NOW);
    expect(i.total).toBe(0);
    expect(i.funnel.every((f) => f.count === 0 && f.pctOfCaptured === 0)).toBe(true);
  });
});
