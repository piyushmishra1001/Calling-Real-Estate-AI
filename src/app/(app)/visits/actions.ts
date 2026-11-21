"use server";

import { revalidatePath } from "next/cache";
import { audit, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Next = "confirm" | "reschedule" | "cancel" | "attended" | "no_show";

/**
 * The only place a visit becomes "confirmed" or "attended". Confirmation requires a person to supply
 * the reserved slot; there is no calendar integration yet, so a human coordinator is the system of record.
 */
export async function updateVisit(form: FormData) {
  const s = await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const action = String(form.get("action")) as Next;
  const when = String(form.get("scheduled_at") ?? "");
  const notes = String(form.get("notes") ?? "");

  const supabase = await createClient();
  const { data: visit } = await supabase.from("site_visits").select("id, lead_id, status, scheduled_at").eq("id", id).maybeSingle();
  if (!visit) return;

  let patch: Record<string, unknown> | null = null;
  let leadStatus: string | null = null;

  if (action === "confirm" || action === "reschedule") {
    if (!when) return;
    const iso = new Date(when);
    if (Number.isNaN(iso.getTime()) || iso.getTime() < Date.now() - 60_000) return; // cannot book in the past
    patch = { status: "confirmed", scheduled_at: iso.toISOString(), confirmation_source: "human", assigned_to: s.userId };
    leadStatus = "visit_confirmed";
  } else if (action === "cancel") {
    patch = { status: "cancelled" };
    leadStatus = "interested";
  } else if (action === "attended") {
    if (visit.status !== "confirmed" || !visit.scheduled_at) return; // only a confirmed visit can be attended
    patch = { status: "attended", attended_at: new Date().toISOString() };
    leadStatus = "visit_attended";
  } else if (action === "no_show") {
    if (visit.status !== "confirmed") return;
    patch = { status: "no_show" };
    leadStatus = "interested";
  }
  if (!patch) return;
  if (notes) patch.notes = notes;

  const { error } = await supabase.from("site_visits").update(patch).eq("id", id);
  if (error) return;
  if (leadStatus) await supabase.from("leads").update({ status: leadStatus }).eq("id", visit.lead_id);
  await supabase.from("lead_activities").insert({ org_id: s.orgId!, lead_id: visit.lead_id, actor_id: s.userId, kind: `visit_${action}`, payload: { scheduled_at: patch.scheduled_at ?? null } });
  await audit(s, `visit.${action}`, "site_visit", id);
  revalidatePath("/visits");
  revalidatePath(`/leads/${visit.lead_id}`);
}

export async function completeTask(form: FormData) {
  await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const supabase = await createClient();
  await supabase.from("callback_tasks").update({ status: "done" }).eq("id", id);
  revalidatePath("/tasks");
}
