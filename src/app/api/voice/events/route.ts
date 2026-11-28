import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { istToIso, leadStatusForCallEnd, PROTECTED_LEAD_STATUSES, verifySignature, workerEvent } from "@/lib/voice/worker-events";

export const runtime = "nodejs";

/**
 * Receives signed reports from the voice worker. The worker only REPORTS; this route is the system of record.
 * It never marks a site visit confirmed, never trusts the ids in a payload without checking them against the call row,
 * and treats an event it has already applied as a no-op.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.VOICE_WORKER_SECRET ?? "";
  if (!verifySignature(secret, req.headers.get("x-timestamp") ?? "", raw, req.headers.get("x-signature") ?? "")) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let parsed;
  try {
    parsed = workerEvent.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "invalid event" }, { status: 422 });
  const ev = parsed.data;

  const admin = createAdminClient();
  // The call row must already exist and match every id the worker claims.
  const { data: call } = await admin.from("calls").select("id, org_id, lead_id, project_id, ended_at").eq("id", ev.call_id).maybeSingle();
  if (!call) return NextResponse.json({ error: "unknown call" }, { status: 404 });
  if (call.org_id !== ev.org_id || call.lead_id !== ev.lead_id || call.project_id !== ev.project_id) {
    return NextResponse.json({ error: "call does not match" }, { status: 409 });
  }
  const { data: lead } = await admin.from("leads").select("id, phone, status, assigned_to").eq("id", call.lead_id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "unknown lead" }, { status: 404 });

  switch (ev.type) {
    case "opt_out": {
      // The database trigger flips the lead to do_not_contact and records consent denied.
      const { error } = await admin.from("opt_outs").upsert({ org_id: call.org_id, phone: lead.phone, reason: "stated on AI call" }, { onConflict: "org_id,phone", ignoreDuplicates: true });
      if (error) return NextResponse.json({ error: "could not record" }, { status: 500 });
      break;
    }
    case "callback_requested": {
      const notes = `AI call: ${ev.reason}${ev.preferred_time ? ` (preferred: ${ev.preferred_time})` : ""}`;
      const { data: dup } = await admin.from("callback_tasks").select("id").eq("lead_id", lead.id).eq("status", "open").eq("notes", notes).maybeSingle();
      if (!dup) await admin.from("callback_tasks").insert({ org_id: call.org_id, lead_id: lead.id, assigned_to: lead.assigned_to, notes });
      break;
    }
    case "visit_requested": {
      const preferred = istToIso(ev.date, ev.time);
      const { data: dup } = await admin.from("site_visits").select("id").eq("lead_id", lead.id).eq("status", "requested").eq("preferred_at", preferred ?? "").maybeSingle();
      // Always 'requested': only a person or the scheduler can confirm a visit.
      if (!dup) await admin.from("site_visits").insert({ org_id: call.org_id, lead_id: lead.id, project_id: call.project_id, preferred_at: preferred, status: "requested" });
      break;
    }
    case "call_ended": {
      if (call.ended_at) break; // already applied
      const spoke = ev.outcome !== "no_response";
      await admin.from("calls").update({
        status: spoke ? "completed" : "no_response",
        connected: spoke,
        ended_at: new Date().toISOString(),
        duration_seconds: ev.duration_seconds,
        transcript: ev.transcript,
        outcome: { outcome: ev.outcome, end_reason: ev.end_reason ?? null, qualification: ev.qualification, visit_requested: ev.visit_requested ?? null, callback_requested: ev.callback_requested ?? null, duration_source: ev.duration_source },
      }).eq("id", call.id);
      await admin.from("lead_activities").insert({ org_id: call.org_id, lead_id: lead.id, kind: "ai_call", payload: { outcome: ev.outcome, duration_seconds: ev.duration_seconds } });
      const next = leadStatusForCallEnd(ev);
      if (next && !PROTECTED_LEAD_STATUSES.includes(lead.status) && next !== lead.status) {
        await admin.from("leads").update({ status: next }).eq("id", lead.id);
      }
      break;
    }
  }
  return NextResponse.json({ ok: true });
}
