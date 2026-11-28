import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, Notice, PageHeader, btn, btnDanger, btnGhost, input, label, LEAD_TONE, pretty } from "@/components/ui";
import { daysAgoIso, dt, inr } from "@/lib/format";
import { ActionForm } from "@/components/simple-form";
import { LeadFields } from "@/components/lead-fields";
import { BAND_LABEL, BAND_TONE, scoreLead, strongestVisitStatus } from "@/lib/insights/score";
import { MANUAL_STATUSES } from "@/lib/lead-status";
import { addNote, assignLead, startTestCall, createCallback, recordOptOut, requestVisit, updateLead, updateLeadDetails, deleteLead } from "../actions";
import { DeleteButton } from "@/components/delete-button";

type Line = { speaker: string; text: string };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error: pageError } = await searchParams;
  const s = await requireRole("partner_admin", "partner_employee");
  const supabase = await createClient();

  // RLS returns nothing for another partner's lead or a colleague's lead: both look like "not found".
  const { data: lead } = await supabase.from("leads").select("*, projects(name, location)").eq("id", id).maybeSingle();
  if (!lead) notFound();

  const [{ data: activities }, { data: calls }, { data: visits }, { data: tasks }, { data: employees }] = await Promise.all([
    supabase.from("lead_activities").select("id, kind, from_status, to_status, payload, created_at, profiles:actor_id(full_name, email)").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("calls").select("id, started_at, duration_seconds, connected, status, outcome, transcript").eq("lead_id", id).order("started_at", { ascending: false }),
    supabase.from("site_visits").select("id, status, preferred_at, scheduled_at, confirmation_source").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("callback_tasks").select("id, due_at, status, notes").eq("lead_id", id).order("created_at", { ascending: false }),
    s.role === "partner_admin" ? supabase.from("profiles").select("id, full_name, email").eq("role", "partner_employee").eq("is_active", true) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
  ]);
  const proj = Array.isArray(lead.projects) ? lead.projects[0] : lead.projects;
  const since = daysAgoIso(30);
  const score = scoreLead({
    status: lead.status,
    budget: lead.budget == null ? null : Number(lead.budget),
    purchase_timeline: lead.purchase_timeline,
    source: lead.source,
    created_at: lead.created_at,
    last_interaction_at: lead.last_interaction_at,
    next_follow_up_at: lead.next_follow_up_at,
    recent_activity_count: (activities ?? []).filter((a) => a.created_at >= since).length,
    visit_status: strongestVisitStatus((visits ?? []).map((v) => v.status)),
  });
  const locked = ["visit_confirmed", "visit_attended", "do_not_contact", "queued", "calling"].includes(lead.status);

  return (
    <>
      <PageHeader
        title={lead.name}
        subtitle={`${lead.phone} · ${proj?.name ?? ""}`}
        actions={<div className="flex items-center gap-2"><Badge tone={LEAD_TONE[lead.status] ?? "slate"}>{pretty(lead.status)}</Badge><Link href="/leads" className={btnGhost}>Back</Link>{s.role === "partner_admin" && <DeleteButton action={deleteLead} id={lead.id} label="Delete lead" confirm={`Delete ${lead.name}? This cannot be undone.`} />}</div>}
      />
      {pageError && <div className="mb-4"><Notice tone="red">{pageError}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {[
                ["Email", lead.email], ["Source", lead.source], ["Enquiry", lead.enquiry_type], ["Configuration", lead.preferred_config],
                ["Location", lead.preferred_location], ["Budget", lead.budget ? inr(lead.budget, 0) : null], ["Timeline", lead.purchase_timeline],
                ["Consent", pretty(lead.consent_status)], ["Last interaction", dt(lead.last_interaction_at)],
              ].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd>{(v as string) || "—"}</dd></div>)}
            </dl>
          </Card>

          <details className="group rounded-2xl border border-[var(--border-default)] bg-white shadow-[var(--shadow-xs)]">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-slate-800">
              Edit details <i className="ri-arrow-down-s-line text-lg text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-[var(--border-subtle)] p-5">
              <ActionForm action={updateLeadDetails} submit="Save details" className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <LeadFields values={lead} />
              </ActionForm>
            </div>
          </details>

          <Card title="Update lead">
            {locked ? (
              <p className="text-sm text-slate-600">
                Status <strong>{pretty(lead.status)}</strong> is managed by the {lead.status.startsWith("visit") ? "site-visit workflow" : lead.status === "do_not_contact" ? "opt-out record (it cannot be reversed here)" : "calling system"}.
              </p>
            ) : (
              <form action={updateLead} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className={label}>Status</label>
                    <select name="status" defaultValue={MANUAL_STATUSES.includes(lead.status) ? lead.status : "new"} className={input}>
                      {MANUAL_STATUSES.map((x) => <option key={x} value={x}>{pretty(x)}</option>)}
                    </select></div>
                  <div><label className={label}>Next follow-up</label>
                    <input type="datetime-local" name="next_follow_up_at" defaultValue={lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toISOString().slice(0, 16) : ""} className={input} /></div>
                </div>
                <div><label className={label}>Notes</label><textarea name="notes" defaultValue={lead.notes ?? ""} rows={3} className={input} /></div>
                <button className={btn}>Save</button>
              </form>
            )}
          </Card>

          {(calls ?? []).length > 0 && <Card title="Call history">
            {(calls ?? []).length === 0 ? <Empty>No calls yet.</Empty> : (
              <ul className="space-y-3">
                {calls!.map((c) => (
                  <li key={c.id} className="rounded border border-slate-200 p-3 text-sm">
                    <div className="flex items-center justify-between"><span>{dt(c.started_at)} · {c.duration_seconds}s</span><Badge tone={c.connected ? "green" : "slate"}>{c.connected ? "Connected" : pretty(c.status)}</Badge></div>
                    {Array.isArray(c.transcript) && c.transcript.length > 0 && (
                      <details className="mt-2"><summary className="cursor-pointer text-xs text-indigo-600">Transcript</summary>
                        <div className="mt-2 space-y-1 text-xs">{(c.transcript as Line[]).map((t, i) => <p key={i}><strong>{t.speaker === "riya" ? "Riya" : "Customer"}:</strong> {t.text}</p>)}</div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>}

          <Card title="Activity">
            <form action={addNote} className="mb-4 flex gap-2"><input type="hidden" name="id" value={id} /><input name="note" placeholder="Add a note…" className={input} /><button className={btn}>Add</button></form>
            {(activities ?? []).length === 0 ? <Empty>No activity yet.</Empty> : (
              <ul className="space-y-2 text-sm">
                {activities!.map((a) => {
                  const who = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
                  const p = (a.payload ?? {}) as { note?: string };
                  return (
                    <li key={a.id} className="border-l-2 border-slate-200 pl-3">
                      <div className="text-xs text-slate-500">{dt(a.created_at)} · {who?.full_name ?? who?.email ?? "System"}</div>
                      <div>{a.kind === "status_change" ? <>Status: {pretty(a.from_status ?? "")} → <strong>{pretty(a.to_status ?? "")}</strong></> : a.kind === "note" ? p.note : pretty(a.kind)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Lead score">
            {score.band === "excluded" ? (
              <p className="text-sm text-slate-600">Not scored: this lead must not be contacted.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="figure text-[28px] font-semibold leading-9 tracking-tight">{score.score}<span className="text-sm font-normal text-slate-500"> / 100</span></span>
                  <Badge tone={BAND_TONE[score.band]}>{BAND_LABEL[score.band]}</Badge>
                </div>
                {score.nextAction && <p className="mt-2 rounded-[10px] bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand)]">Next: {score.nextAction}</p>}
                <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-[var(--brand-accent)]">How is this calculated?</summary><ul className="mt-3 space-y-2 text-xs">
                  {score.reasons.map((r) => (
                    <li key={r.label}>
                      <div className="flex justify-between text-slate-600"><span>{r.label}</span><span className="figure">{r.points}/{r.max}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${(r.points / r.max) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul><p className="mt-3 text-xs text-slate-500">A rule-based guide for prioritising. It is not a prediction.</p></details>
              </>
            )}
          </Card>
          {s.role === "partner_admin" && (
            <Card title="Assignment">
              <form action={assignLead} className="space-y-2"><input type="hidden" name="id" value={id} />
                <select name="assigned_to" defaultValue={lead.assigned_to ?? ""} className={input}>
                  <option value="">Unassigned</option>
                  {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name ?? e.email}</option>)}
                </select>
                <button className={btnGhost}>Reassign</button></form>
            </Card>
          )}
          <Card title="Site visit">
            {(visits ?? []).map((v) => (
              <div key={v.id} className="mb-2 rounded border border-slate-200 p-2 text-sm">
                <Badge tone={v.status === "confirmed" || v.status === "attended" ? "green" : "amber"}>{pretty(v.status)}</Badge>
                <div className="mt-1 text-xs text-slate-600">{v.scheduled_at ? `Scheduled ${dt(v.scheduled_at)}` : `Preferred ${dt(v.preferred_at)}`}</div>
              </div>
            ))}
            <form action={requestVisit} className="space-y-2"><input type="hidden" name="id" value={id} />
              <label className={label}>Preferred date and time</label>
              <input type="datetime-local" name="preferred_at" className={input} />
              <button className={btnGhost}>Request visit</button>
              <p className="text-xs text-slate-500">A visit is only marked confirmed once a coordinator reserves the slot.</p></form>
          </Card>
          {lead.status !== "do_not_contact" && (
            <Card title="Talk to Riya (test)">
              <form action={startTestCall} className="space-y-2"><input type="hidden" name="id" value={id} />
                <select name="language" className={input} defaultValue="en-IN" aria-label="Language"><option value="en-IN">English</option><option value="hi-IN">Hindi</option></select>
                <button className={btn}>Start test call</button>
                <p className="text-xs text-slate-500">Runs in your browser with this project&apos;s approved facts. No phone call is placed. The result is saved on this lead.</p></form>
            </Card>
          )}
          <Card title="Callback">
            {(tasks ?? []).filter((t) => t.status === "open").map((t) => <div key={t.id} className="mb-2 text-sm">Due {dt(t.due_at)}{t.notes ? ` — ${t.notes}` : ""}</div>)}
            <form action={createCallback} className="space-y-2"><input type="hidden" name="id" value={id} />
              <input type="datetime-local" name="due_at" className={input} />
              <input name="notes" placeholder="Reason" className={input} />
              <button className={btnGhost}>Schedule callback</button></form>
          </Card>
          {lead.status !== "do_not_contact" && (
            <details className="rounded-2xl border border-[var(--border-default)] bg-white px-5 py-3.5 shadow-[var(--shadow-xs)]">
              <summary className="cursor-pointer text-sm font-medium text-slate-600">Customer asked not to be contacted?</summary>
              <p className="my-3 text-sm text-slate-600">This stops all future calls to this number and cannot be undone here.</p>
              <form action={recordOptOut}><input type="hidden" name="id" value={id} /><button className={btnDanger}>Mark as do not contact</button></form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
