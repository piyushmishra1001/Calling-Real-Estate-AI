import { notFound } from "next/navigation";
import { requireCalling } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Notice, PageHeader, Stat, btn, btnDanger, btnGhost, pretty } from "@/components/ui";
import { inr, num, pct } from "@/lib/format";
import { costPerAttendedVisit } from "@/lib/voice/cost";
import { setCampaignStatus, startCampaign } from "../actions";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await requireCalling("partner_admin");
  const supabase = await createClient();
  const { data: c } = await supabase.from("campaigns").select("*, projects(name)").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [{ data: cl }, { data: calls }, { data: visits }] = await Promise.all([
    supabase.from("campaign_leads").select("state").eq("campaign_id", id),
    supabase.from("calls").select("connected, duration_seconds, stt_cost_inr, tts_cost_inr, llm_cost_inr, orchestration_cost_inr, telephony_cost_inr, lead_id").eq("campaign_id", id),
    supabase.from("site_visits").select("status, lead_id"),
  ]);
  const proj = Array.isArray(c.projects) ? c.projects[0] : c.projects;
  const states = new Map<string, number>();
  for (const r of cl ?? []) states.set(r.state, (states.get(r.state) ?? 0) + 1);
  const callList = calls ?? [];
  const connected = callList.filter((x) => x.connected).length;
  const minutes = callList.reduce((a, x) => a + x.duration_seconds, 0) / 60;
  const ai = callList.reduce((a, x) => a + Number(x.stt_cost_inr) + Number(x.tts_cost_inr) + Number(x.llm_cost_inr) + Number(x.orchestration_cost_inr), 0);
  const tel = callList.reduce((a, x) => a + Number(x.telephony_cost_inr), 0);
  const leadIds = new Set(callList.map((x) => x.lead_id));
  const attended = (visits ?? []).filter((v) => v.status === "attended" && leadIds.has(v.lead_id)).length;
  const blocked = typeof sp.blocked === "string" ? sp.blocked.split(" | ") : [];
  const canStart = ["draft", "paused"].includes(c.status);

  return (
    <>
      <PageHeader title={c.name} subtitle={`${proj?.name} · window ${String(c.window_start).slice(0, 5)}–${String(c.window_end).slice(0, 5)} IST`} actions={<Badge tone={c.status === "running" ? "green" : c.status === "stopped" ? "red" : "amber"}>{pretty(c.status)}</Badge>} />
      <div className="mb-4"><Notice tone="blue">No telephony provider is connected yet, so starting a campaign queues eligible leads but <strong>does not place any calls</strong>.</Notice></div>
      {blocked.length > 0 && <div className="mb-4"><Notice tone="red"><div className="font-medium">This campaign cannot start:</div><ul className="list-disc pl-5">{blocked.map((b) => <li key={b}>{b}</li>)}</ul></Notice></div>}
      <div className="mb-4 flex flex-wrap gap-2">
        {canStart && <form action={startCampaign}><input type="hidden" name="id" value={id} /><button className={btn}>{c.status === "paused" ? "Resume" : "Start campaign"}</button></form>}
        {c.status === "running" && <form action={setCampaignStatus}><input type="hidden" name="id" value={id} /><button name="to" value="paused" className={btnGhost}>Pause</button></form>}
        {["draft", "running", "paused"].includes(c.status) && <form action={setCampaignStatus}><input type="hidden" name="id" value={id} /><button name="to" value="stopped" className={btnDanger}>Stop</button></form>}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Queued" value={num(states.get("queued") ?? 0)} />
        <Stat label="Calls attempted" value={num(callList.length)} />
        <Stat label="Connected" value={num(connected)} hint={pct(connected, callList.length)} />
        <Stat label="Connected minutes" value={minutes.toFixed(1)} />
        <Stat label="AI cost" value={inr(ai)} />
        <Stat label="Telephony" value={inr(tel)} />
        <Stat label="Visits attended" value={num(attended)} />
        <Stat label="Cost / attended visit" value={(() => { const x = costPerAttendedVisit(ai + tel, attended); return x == null ? "—" : inr(x); })()} />
      </div>
      <div className="mt-4"><Card title="Rules"><p className="text-sm text-slate-700">Up to {c.max_retries} retr{c.max_retries === 1 ? "y" : "ies"} per lead · {c.concurrency} concurrent call{c.concurrency === 1 ? "" : "s"}. Only leads with recorded consent that are not opted out are queued.</p></Card></div>
    </>
  );
}
