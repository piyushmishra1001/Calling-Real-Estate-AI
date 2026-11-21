import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, Notice, PageHeader, Stat, btn, btnDanger, pretty } from "@/components/ui";
import { num } from "@/lib/format";
import { setKillSwitch, stopAnyCampaign } from "../actions";

export default async function CallingPage() {
  await requireRole("super_admin");
  const supabase = await createClient();
  const [{ data: settings }, { data: campaigns }, { data: orgs }, { data: ents }] = await Promise.all([
    supabase.from("platform_settings").select("calling_kill_switch, updated_at").eq("id", 1).maybeSingle(),
    supabase.from("campaigns").select("id, name, status, org_id, projects(name)").in("status", ["running", "paused", "draft"]).order("created_at", { ascending: false }),
    supabase.from("organizations").select("id, name"),
    supabase.from("org_entitlements").select("org_id, monthly_minute_limit"),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const on = !!settings?.calling_kill_switch;

  const alerts: { org: string; level: number }[] = [];
  for (const e of ents ?? []) {
    if (e.monthly_minute_limit > 0) {
      const { data: lvl } = await supabase.rpc("usage_alert_level", { p_org: e.org_id });
      if (lvl) alerts.push({ org: orgName.get(e.org_id) ?? e.org_id, level: lvl });
    }
  }

  return (
    <>
      <PageHeader title="Calling controls" />
      <Card title="Emergency kill switch">
        <p className="mb-3 text-sm text-slate-700">When on, no partner can start or continue AI calling. Use it if something is going wrong.</p>
        <form action={setKillSwitch} className="flex items-center gap-3">
          <Badge tone={on ? "red" : "green"}>{on ? "CALLING PAUSED" : "Calling enabled"}</Badge>
          <button name="on" value={String(!on)} className={on ? btn : btnDanger}>{on ? "Resume calling" : "Stop all calling now"}</button>
        </form>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4"><Stat label="Open campaigns" value={num((campaigns ?? []).length)} /><Stat label="Usage alerts" value={num(alerts.length)} /></div>
      {alerts.length > 0 && <div className="mt-4 space-y-2">{alerts.map((a) => <Notice key={a.org} tone={a.level === 100 ? "red" : "amber"}>{a.org} has used {a.level}% of this month&apos;s AI minutes.</Notice>)}</div>}
      <div className="mt-4"><Card title="Campaigns">
        {(campaigns ?? []).length === 0 ? <Empty>No open campaigns.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {campaigns!.map((c) => { const p = Array.isArray(c.projects) ? c.projects[0] : c.projects; return (
              <li key={c.id} className="flex items-center justify-between py-2">
                <div><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{orgName.get(c.org_id)} · {p?.name}</div></div>
                <div className="flex items-center gap-2"><Badge tone={c.status === "running" ? "green" : "amber"}>{pretty(c.status)}</Badge>
                  <form action={stopAnyCampaign}><input type="hidden" name="id" value={c.id} /><button className={btnDanger}>Stop</button></form></div>
              </li>
            ); })}
          </ul>
        )}
      </Card></div>
    </>
  );
}
