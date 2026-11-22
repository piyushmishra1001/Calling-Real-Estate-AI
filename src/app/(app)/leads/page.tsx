import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, btn, btnGhost, input, LEAD_TONE, pretty } from "@/components/ui";
import { daysAgoIso, dt } from "@/lib/format";
import { BAND_LABEL, BAND_TONE, scoreLead, strongestVisitStatus } from "@/lib/insights/score";
import { bulkAssign } from "./actions";

const PAGE = 50;
const STATUSES = ["new", "queued", "calling", "connected", "interested", "callback_requested", "visit_requested", "visit_confirmed", "visit_attended", "not_interested", "wrong_number", "do_not_contact"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const s = await requireRole("partner_admin", "partner_employee");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : "";
  const project = typeof sp.project === "string" ? sp.project : "";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("id, name, phone, status, consent_status, budget, purchase_timeline, source, created_at, last_interaction_at, next_follow_up_at, projects(name), profiles:assigned_to(full_name, email)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) query = query.eq("status", status);
  if (project) query = query.eq("project_id", project);
  if (q) query = query.or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,phone.ilike.%${q.replace(/[%,()]/g, "")}%`);

  const [{ data: leads, count }, { data: projects }, { data: employees }] = await Promise.all([
    query,
    supabase.from("projects").select("id, name").order("name"),
    s.role === "partner_admin" ? supabase.from("profiles").select("id, full_name, email").eq("role", "partner_employee").eq("is_active", true) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
  ]);

  // Scores for the leads on this page only: two small lookups, not the whole pipeline.
  const ids = (leads ?? []).map((l) => l.id);
  const [{ data: acts }, { data: vis }] = ids.length
    ? await Promise.all([
        supabase.from("lead_activities").select("lead_id").in("lead_id", ids).gte("created_at", daysAgoIso(30)),
        supabase.from("site_visits").select("lead_id, status").in("lead_id", ids),
      ])
    : [{ data: [] as { lead_id: string }[] }, { data: [] as { lead_id: string; status: string }[] }];
  const actCount = new Map<string, number>();
  for (const a of acts ?? []) actCount.set(a.lead_id, (actCount.get(a.lead_id) ?? 0) + 1);
  const visitsBy = new Map<string, string[]>();
  for (const v of vis ?? []) visitsBy.set(v.lead_id, [...(visitsBy.get(v.lead_id) ?? []), v.status]);
  const scoreOf = (l: NonNullable<typeof leads>[number]) =>
    scoreLead({
      status: l.status, budget: l.budget == null ? null : Number(l.budget), purchase_timeline: l.purchase_timeline, source: l.source,
      created_at: l.created_at, last_interaction_at: l.last_interaction_at, next_follow_up_at: l.next_follow_up_at,
      recent_activity_count: actCount.get(l.id) ?? 0, visit_status: strongestVisitStatus(visitsBy.get(l.id) ?? []),
    });
  const isAdmin = s.role === "partner_admin";
  const total = count ?? 0;
  const qs = (p: number) => new URLSearchParams({ ...(status && { status }), ...(project && { project }), ...(q && { q }), page: String(p) }).toString();

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={s.role === "partner_admin" ? "All leads in your organisation." : "Leads assigned to you."}
        actions={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {/* A file download, not a page: a plain link is correct here. */}
            <a href="/leads/export" download className={btnGhost}>Export CSV</a>
            <Link href="/leads/import" className={btnGhost}>Import CSV</Link>
            <Link href="/leads/new" className={btn}>Add lead</Link>
          </div>
        ) : undefined}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name or phone" className={input + " max-w-xs"} />
        <select name="status" defaultValue={status} className={input + " max-w-[11rem]"}>
          <option value="">All statuses</option>
          {STATUSES.map((x) => <option key={x} value={x}>{pretty(x)}</option>)}
        </select>
        <select name="project" defaultValue={project} className={input + " max-w-[13rem]"}>
          <option value="">All projects</option>
          {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className={btnGhost}>Filter</button>
      </form>
      <Card>
        {(leads ?? []).length === 0 ? <Empty>No leads match.</Empty> : (
          <form action={bulkAssign}>
          {isAdmin && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">With selected:</span>
              <select name="assigned_to" className={input + " max-w-[13rem]"}>
                <option value="">Unassign</option>
                {(employees ?? []).map((e) => <option key={e.id} value={e.id}>Assign to {e.full_name ?? e.email}</option>)}
              </select>
              <button className={btnGhost}>Apply</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500">{isAdmin && <th className="w-8 pb-2" />}<th className="pb-2">Name</th><th>Score</th><th>Phone</th><th>Project</th><th>Status</th><th>Consent</th><th>Owner</th><th>Follow-up</th></tr></thead>
              <tbody>
                {leads!.map((l) => {
                  const proj = Array.isArray(l.projects) ? l.projects[0] : l.projects;
                  const owner = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      {isAdmin && <td className="py-2"><input type="checkbox" name="ids" value={l.id} aria-label={`Select ${l.name}`} /></td>}
                      <td className="py-2"><Link href={`/leads/${l.id}`} className="font-medium text-indigo-700">{l.name}</Link></td>
                      <td>{(() => { const r = scoreOf(l); return r.band === "excluded" ? <span className="text-slate-400">—</span> : <span title={r.reasons.map((x) => `${x.label}: ${x.points}/${x.max}`).join("\n")}><Badge tone={BAND_TONE[r.band]}>{BAND_LABEL[r.band]} {r.score}</Badge></span>; })()}</td>
                      <td className="text-slate-600">{l.phone}</td>
                      <td>{proj?.name}</td>
                      <td><Badge tone={LEAD_TONE[l.status] ?? "slate"}>{pretty(l.status)}</Badge></td>
                      <td><Badge tone={l.consent_status === "granted" ? "green" : l.consent_status === "denied" ? "red" : "amber"}>{pretty(l.consent_status)}</Badge></td>
                      <td className="text-slate-600">{owner?.full_name ?? owner?.email ?? "Unassigned"}</td>
                      <td className="text-slate-600">{dt(l.next_follow_up_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </form>
        )}
      </Card>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{total} lead{total === 1 ? "" : "s"}</span>
        <span className="flex gap-2">
          {page > 1 && <Link className={btnGhost} href={`/leads?${qs(page - 1)}`}>Previous</Link>}
          {page * PAGE < total && <Link className={btnGhost} href={`/leads?${qs(page + 1)}`}>Next</Link>}
        </span>
      </div>
    </>
  );
}
