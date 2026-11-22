import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, Notice, Stat, pretty } from "@/components/ui";
import { daysAgoIso, num } from "@/lib/format";
import { buildInsights, type LeadRow } from "@/lib/insights/metrics";
import { BAND_LABEL, BAND_TONE } from "@/lib/insights/score";

const MAX_LEADS = 5000;
const VISIT_RANK: Record<string, number> = { attended: 4, confirmed: 3, pending_confirmation: 2, requested: 1 };

export default async function InsightsPage() {
  const s = await requireRole("partner_admin", "partner_employee");
  const supabase = await createClient();
  const since = daysAgoIso(30);

  const [leadsRes, actsRes, visitsRes, projectsRes, teamRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, project_id, assigned_to, status, budget, purchase_timeline, source, created_at, last_interaction_at, next_follow_up_at")
      .order("created_at", { ascending: false })
      .limit(MAX_LEADS),
    supabase.from("lead_activities").select("lead_id").gte("created_at", since).limit(50000),
    supabase.from("site_visits").select("lead_id, status").limit(50000),
    supabase.from("projects").select("id, name"),
    s.role === "partner_admin" ? supabase.from("profiles").select("id, full_name, email") : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
  ]);

  if (leadsRes.error) return <Notice tone="red">Could not load insights.</Notice>;

  const activity = new Map<string, number>();
  for (const a of actsRes.data ?? []) activity.set(a.lead_id, (activity.get(a.lead_id) ?? 0) + 1);
  const visit = new Map<string, string>();
  for (const v of visitsRes.data ?? []) {
    if (!(v.status in VISIT_RANK)) continue;
    const cur = visit.get(v.lead_id);
    if (!cur || VISIT_RANK[v.status] > VISIT_RANK[cur]) visit.set(v.lead_id, v.status);
  }

  const rows: LeadRow[] = (leadsRes.data ?? []).map((l) => ({
    ...l,
    budget: l.budget == null ? null : Number(l.budget),
    recent_activity_count: activity.get(l.id) ?? 0,
    visit_status: visit.get(l.id) ?? null,
  }));
  const ins = buildInsights(rows);
  const projectName = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));
  const personName = new Map((teamRes.data ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "Unnamed"]));
  const capped = (leadsRes.data ?? []).length >= MAX_LEADS;

  return (
    <>
      <PageHeader
        title="Lead insights"
        subtitle={s.role === "partner_admin" ? "How your leads are moving, and where to act next." : "Your leads, ranked by where your time is best spent."}
      />
      <div className="mb-4">
        <Notice tone="blue">
          Scores are rule-based and explainable: status, timeline, budget, engagement and recency. They are a guide for prioritising, not a prediction. Hover a score to see how it was built.
        </Notice>
      </div>
      {capped && <div className="mb-4"><Notice tone="amber">Showing insights for the most recent {num(MAX_LEADS)} leads.</Notice></div>}

      {ins.total === 0 ? (
        <Card><Empty>No leads yet. Import a CSV from the Leads page to see insights.</Empty></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Hot leads" value={num(ins.bands.hot)} hint="Score 70 and above" />
            <Stat label="Warm leads" value={num(ins.bands.warm)} hint="Score 45 to 69" />
            <Stat label="Follow-ups overdue" value={num(ins.overdueFollowUps)} hint="Past their due date" />
            <Stat label="New, never contacted" value={num(ins.untouchedNew)} hint="Waiting for first contact" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card title="Pipeline">
              <ul className="space-y-3">
                {ins.funnel.map((f) => (
                  <li key={f.key}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-[var(--text-title)]">{f.label}</span>
                      <span className="figure text-[var(--text-body)]">
                        {num(f.count)}
                        {f.pctOfPrev != null && <span className="ml-2 text-xs">{f.pctOfPrev.toFixed(0)}% of previous stage</span>}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.max(f.pctOfCaptured, f.count > 0 ? 2 : 0)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Lead quality">
              <ul className="space-y-2 text-sm">
                {(["hot", "warm", "cold", "low"] as const).map((b) => (
                  <li key={b} className="flex items-center justify-between">
                    <Badge tone={BAND_TONE[b]}>{BAND_LABEL[b]}</Badge>
                    <span className="figure text-[var(--text-body)]">{num(ins.bands[b])}</span>
                  </li>
                ))}
                {ins.bands.excluded > 0 && (
                  <li className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
                    <span className="text-[var(--text-body)]">Excluded (wrong number, do not contact)</span>
                    <span className="figure text-[var(--text-body)]">{num(ins.bands.excluded)}</span>
                  </li>
                )}
              </ul>
              <p className="mt-4 text-sm text-[var(--text-body)]">
                {num(ins.missingBudgetOrTimeline)} lead{ins.missingBudgetOrTimeline === 1 ? " is" : "s are"} missing a budget or timeline, which holds their score down.
              </p>
            </Card>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card title="Hot leads">
              {ins.hot.length === 0 ? <Empty>No hot leads right now.</Empty> : <LeadList items={ins.hot} />}
            </Card>
            <Card title="Needs attention">
              {ins.needsAttention.length === 0 ? <Empty>Nothing needs action.</Empty> : <LeadList items={ins.needsAttention} showAction />}
            </Card>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card title="Lead sources">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-[var(--text-body)]"><th className="pb-2">Source</th><th>Leads</th><th>Interested</th><th>Visits</th></tr></thead>
                <tbody>
                  {ins.bySource.map((x) => (
                    <tr key={x.source} className="border-t border-[var(--border-subtle)]">
                      <td className="py-2">{x.source}</td>
                      <td>{num(x.leads)}</td>
                      <td>{num(x.interested)} <span className="text-xs text-[var(--text-body)]">({x.interestedPct.toFixed(0)}%)</span></td>
                      <td>{num(x.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Projects">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-[var(--text-body)]"><th className="pb-2">Project</th><th>Leads</th><th>Hot</th><th>Visits</th></tr></thead>
                <tbody>
                  {ins.byProject.map((x) => (
                    <tr key={x.projectId} className="border-t border-[var(--border-subtle)]">
                      <td className="py-2">{projectName.get(x.projectId) ?? "Project"}</td>
                      <td>{num(x.leads)}</td><td>{num(x.hot)}</td><td>{num(x.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {s.role === "partner_admin" && (
            <div className="mt-6">
              <Card title="Team">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-[var(--text-body)]"><th className="pb-2">Owner</th><th>Leads</th><th>Hot</th><th>Overdue follow-ups</th><th>Average score</th></tr></thead>
                  <tbody>
                    {ins.byOwner.map((x) => (
                      <tr key={x.ownerId ?? "none"} className="border-t border-[var(--border-subtle)]">
                        <td className="py-2">{x.ownerId ? personName.get(x.ownerId) ?? "Team member" : "Unassigned"}</td>
                        <td>{num(x.leads)}</td><td>{num(x.hot)}</td>
                        <td className={x.overdue > 0 ? "font-medium text-[var(--state-error-base)]" : ""}>{num(x.overdue)}</td>
                        <td>{x.avgScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}

function LeadList({ items, showAction }: { items: ReturnType<typeof buildInsights>["hot"]; showAction?: boolean }) {
  return (
    <ul className="divide-y divide-[var(--border-subtle)] text-sm">
      {items.map((l) => (
        <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link href={`/leads/${l.id}`} className="font-medium text-indigo-700">{l.name}</Link>
            <div className="text-xs text-[var(--text-body)]">
              {pretty(l.status)}
              {showAction && l.result.nextAction ? ` · ${l.result.nextAction}` : l.result.nextAction ? ` · Next: ${l.result.nextAction}` : ""}
            </div>
          </div>
          <span title={l.result.reasons.map((r) => `${r.label}: ${r.points}/${r.max}`).join("\n")}>
            <Badge tone={BAND_TONE[l.result.band]}>{BAND_LABEL[l.result.band]} {l.result.score}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}
