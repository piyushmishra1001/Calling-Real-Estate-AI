import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, Notice, PageHeader, Stat, LEAD_TONE, pretty } from "@/components/ui";
import { dt, inr, num, pct } from "@/lib/format";
import { costPerAttendedVisit } from "@/lib/voice/cost";

export default async function DashboardPage() {
  const s = await requireRole("super_admin", "partner_admin", "partner_employee");
  if (s.role === "super_admin") return <SuperAdminDashboard />;
  if (s.role === "partner_admin") return <PartnerDashboard orgId={s.orgId!} calling={s.callingEnabled} />;
  return <EmployeeDashboard userId={s.userId} />;
}

async function SuperAdminDashboard() {
  const supabase = await createClient();
  const { data: st, error } = await supabase.rpc("platform_stats");
  if (error || !st) return <Notice tone="red">Could not load platform statistics.</Notice>;
  const totalCost = Number(st.ai_cost_inr) + Number(st.telephony_cost_inr);
  const minutes = Number(st.connected_minutes);
  const perAttended = costPerAttendedVisit(totalCost, st.visits_attended);
  const { data: orgs } = await supabase.from("org_entitlements").select("org_id, monthly_minute_limit");
  const withLimit = (orgs ?? []).filter((o) => o.monthly_minute_limit > 0).length;

  return (
    <>
      <PageHeader title="Platform overview" subtitle="Aggregates only. Customer records stay inside each partner's workspace." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active partners" value={num(st.partners_active)} hint={`${st.partners_suspended} suspended or inactive`} />
        <Stat label="Projects" value={num(st.projects)} />
        <Stat label="Leads" value={num(st.leads)} />
        <Stat label="Partners with AI minutes" value={num(withLimit)} />
        <Stat label="Calls attempted" value={num(st.calls_attempted)} />
        <Stat label="Calls connected" value={num(st.calls_connected)} hint={pct(st.calls_connected, st.calls_attempted)} />
        <Stat label="Connected minutes" value={num(minutes.toFixed(1))} />
        <Stat label="Visits attended" value={num(st.visits_attended)} hint={`${st.visits_confirmed} confirmed, ${st.visits_requested} requested`} />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-800">Cost (measured, not estimated)</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="AI cost" value={inr(st.ai_cost_inr)} hint="STT + TTS + LLM + orchestration" />
        <Stat label="Telephony cost" value={inr(st.telephony_cost_inr)} hint="Reported separately" />
        <Stat label="AI cost / connected min" value={minutes > 0 ? inr(Number(st.ai_cost_inr) / minutes) : "—"} hint="Target ₹1.70 (≈$0.02); not a claim until 100+ real calls" />
        <Stat label="Total cost / connected min" value={minutes > 0 ? inr(totalCost / minutes) : "—"} />
        <Stat label="Cost per attended visit" value={perAttended == null ? "—" : inr(perAttended)} hint="North-star metric" />
      </div>
      {Number(st.calls_attempted) === 0 && (
        <div className="mt-6"><Notice tone="blue">No calls have been placed yet, so there is no real cost data. Figures above fill in from actual call records only.</Notice></div>
      )}
    </>
  );
}

async function PartnerDashboard({ orgId, calling }: { orgId: string; calling: boolean }) {
  const supabase = await createClient();
  const [{ data: st, error }, { data: employees }, { data: campaigns }, { data: leadRows }] = await Promise.all([
    supabase.rpc("partner_stats", { p_org: orgId }),
    supabase.from("profiles").select("id, full_name, email").eq("role", "partner_employee"),
    supabase.from("campaigns").select("id, name, status").order("created_at", { ascending: false }).limit(5),
    supabase.from("leads").select("assigned_to, status"),
  ]);
  const { data: level } = await supabase.rpc("usage_alert_level", { p_org: orgId });
  if (error || !st) return <Notice tone="red">Could not load your dashboard.</Notice>;

  const used = Number(st.minutes_used);
  const limit = Number(st.minutes_limit);
  const byEmployee = new Map<string, { total: number; interested: number }>();
  for (const l of leadRows ?? []) {
    if (!l.assigned_to) continue;
    const e = byEmployee.get(l.assigned_to) ?? { total: 0, interested: 0 };
    e.total++;
    if (["interested", "visit_requested", "visit_confirmed", "visit_attended"].includes(l.status)) e.interested++;
    byEmployee.set(l.assigned_to, e);
  }

  return (
    <>
      <PageHeader title="Dashboard" />
      {level === 100 && <div className="mb-4"><Notice tone="red">You have used 100% of this month&apos;s AI minutes. Campaigns are paused. Ask LeadPilot to upgrade your plan.</Notice></div>}
      {level === 85 && <div className="mb-4"><Notice tone="amber">85% of this month&apos;s AI minutes used.</Notice></div>}
      {level === 70 && <div className="mb-4"><Notice tone="amber">70% of this month&apos;s AI minutes used.</Notice></div>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total leads" value={num(st.leads_total)} hint={`${st.leads_new} new`} />
        {calling && <Stat label="Eligible to call" value={num(st.leads_eligible)} hint="Consent recorded, not opted out" />}
        {calling && <Stat label="Calls attempted" value={num(st.calls_attempted)} />}
        {calling && <Stat label="Calls connected" value={num(st.calls_connected)} hint={pct(st.calls_connected, st.calls_attempted)} />}
        <Stat label="Interested leads" value={num(st.leads_interested)} />
        <Stat label="Callbacks open" value={num(st.callbacks_open)} />
        <Stat label="Visits requested" value={num(st.visits_requested)} />
        <Stat label="Visits confirmed / attended" value={`${st.visits_confirmed} / ${st.visits_attended}`} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {calling && <Card title="AI usage this month">
          {limit > 0 ? (
            <>
              <div className="mb-2 text-sm text-slate-700">{used.toFixed(1)} of {num(limit)} minutes used · {Math.max(limit - used, 0).toFixed(1)} remaining</div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-600" style={{ width: `${Math.min((used / limit) * 100, 100)}%` }} /></div>
            </>
          ) : <p className="text-sm text-slate-600">Your plan includes no AI calling minutes.</p>}
        </Card>}
        {!calling && (
          <Card title="Lead insights" action={<Link href="/insights" className="text-xs text-indigo-600">Open</Link>}>
            <p className="text-sm text-[var(--text-body)]">See which leads are hot, where follow-ups are overdue, and which sources convert.</p>
          </Card>
        )}
        <Card title="Employee performance">
          {byEmployee.size === 0 ? <Empty>No assigned leads yet.</Empty> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2">Employee</th><th>Leads</th><th>Interested</th></tr></thead>
              <tbody>
                {(employees ?? []).filter((e) => byEmployee.has(e.id)).map((e) => (
                  <tr key={e.id} className="border-t border-slate-100"><td className="py-2">{e.full_name ?? e.email}</td><td>{byEmployee.get(e.id)!.total}</td><td>{byEmployee.get(e.id)!.interested}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {calling && <Card title="Recent campaigns" action={<Link href="/campaigns" className="text-xs text-indigo-600">View all</Link>}>
          {(campaigns ?? []).length === 0 ? <Empty>No campaigns yet.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {campaigns!.map((c) => <li key={c.id} className="flex items-center justify-between py-2"><Link href={`/campaigns/${c.id}`} className="text-indigo-700">{c.name}</Link><Badge>{pretty(c.status)}</Badge></li>)}
            </ul>
          )}
        </Card>}
        {calling && <Card title="Cost">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">AI processing</dt><dd>{inr(st.ai_cost_inr)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Telephony</dt><dd>{inr(st.telephony_cost_inr)}</dd></div>
            <div className="flex justify-between border-t pt-1 font-medium"><dt>Cost per attended visit</dt><dd>{(() => { const c = costPerAttendedVisit(Number(st.ai_cost_inr) + Number(st.telephony_cost_inr), st.visits_attended); return c == null ? "—" : inr(c); })()}</dd></div>
          </dl>
        </Card>}
      </div>
    </>
  );
}

async function EmployeeDashboard({ userId }: { userId: string }) {
  const supabase = await createClient();
  const [{ data: leads }, { data: tasks }, { data: visits }] = await Promise.all([
    supabase.from("leads").select("id, name, status, next_follow_up_at").order("next_follow_up_at", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("callback_tasks").select("id, due_at, notes, leads(id, name)").eq("assigned_to", userId).eq("status", "open").order("due_at", { ascending: true }).limit(10),
    supabase.from("site_visits").select("id, status, scheduled_at, preferred_at, leads(id, name)").in("status", ["requested", "pending_confirmation", "confirmed"]).limit(10),
  ]);
  const counts = new Map<string, number>();
  for (const l of leads ?? []) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
  return (
    <>
      <PageHeader title="My work" subtitle="Leads assigned to you." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="My leads" value={num((leads ?? []).length)} />
        <Stat label="New" value={num(counts.get("new") ?? 0)} />
        <Stat label="Interested" value={num(counts.get("interested") ?? 0)} />
        <Stat label="Open callbacks" value={num((tasks ?? []).length)} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Callbacks due" action={<Link href="/tasks" className="text-xs text-indigo-600">All</Link>}>
          {(tasks ?? []).length === 0 ? <Empty>Nothing due.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {tasks!.map((t) => { const l = Array.isArray(t.leads) ? t.leads[0] : t.leads; return (
                <li key={t.id} className="flex justify-between py-2"><Link href={`/leads/${l?.id}`} className="text-indigo-700">{l?.name}</Link><span className="text-slate-500">{dt(t.due_at)}</span></li>
              ); })}
            </ul>
          )}
        </Card>
        <Card title="Site visits" action={<Link href="/visits" className="text-xs text-indigo-600">All</Link>}>
          {(visits ?? []).length === 0 ? <Empty>No upcoming visits.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {visits!.map((v) => { const l = Array.isArray(v.leads) ? v.leads[0] : v.leads; return (
                <li key={v.id} className="flex items-center justify-between py-2"><Link href={`/leads/${l?.id}`} className="text-indigo-700">{l?.name}</Link><span className="flex items-center gap-2"><Badge tone={v.status === "confirmed" ? "green" : "amber"}>{pretty(v.status)}</Badge><span className="text-slate-500">{dt(v.scheduled_at ?? v.preferred_at)}</span></span></li>
              ); })}
            </ul>
          )}
        </Card>
        <Card title="Lead status">
          <div className="flex flex-wrap gap-2">{[...counts.entries()].map(([k, v]) => <Badge key={k} tone={LEAD_TONE[k] ?? "slate"}>{pretty(k)}: {v}</Badge>)}</div>
        </Card>
      </div>
    </>
  );
}
