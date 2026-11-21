"use server";

import { revalidatePath } from "next/cache";
import { audit, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseLeadCsv, type RejectedRow } from "@/lib/csv-import";
import { MANUAL_STATUSES } from "@/lib/lead-status";

export type ImportState =
  | undefined
  | { error: string }
  | { done: true; inserted: number; rejected: RejectedRow[]; optedOut: number; consentUnknown: number };

const CHUNK = 500;

export async function importLeads(_: ImportState, form: FormData): Promise<ImportState> {
  const s = await requireRole("partner_admin");
  const projectId = String(form.get("project_id") ?? "");
  const csv = String(form.get("csv") ?? "");
  const assignTo = String(form.get("assign_to") ?? "");
  if (!projectId) return { error: "Choose a project." };
  if (!csv.trim()) return { error: "Choose a CSV file." };

  const supabase = await createClient();
  // RLS already restricts this to projects assigned to the caller's organisation.
  const { data: project } = await supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle();
  if (!project) return { error: "That project is not assigned to your organisation." };

  const [{ data: existing }, { data: optOuts }, { data: employees }] = await Promise.all([
    supabase.from("leads").select("phone").eq("project_id", projectId).limit(50_000),
    supabase.from("opt_outs").select("phone").limit(50_000),
    supabase.from("profiles").select("id").eq("role", "partner_employee").eq("is_active", true),
  ]);

  // Authoritative validation happens here, on the server, regardless of what the browser previewed.
  const result = parseLeadCsv(csv, {
    existingPhones: new Set((existing ?? []).map((r) => r.phone)),
    optedOutPhones: new Set((optOuts ?? []).map((r) => r.phone)),
  });
  if (result.fatal) return { error: result.fatal };
  if (result.valid.length === 0) return { done: true, inserted: 0, rejected: result.rejected, optedOut: 0, consentUnknown: 0 };

  const staff = (employees ?? []).map((e) => e.id);
  if (assignTo && assignTo !== "unassigned" && assignTo !== "distribute" && !staff.includes(assignTo)) {
    return { error: "That employee is not in your organisation." };
  }

  const rows = result.valid.map((r, i) => ({
    ...r,
    org_id: s.orgId!,
    project_id: projectId,
    assigned_to:
      assignTo === "distribute" && staff.length > 0 ? staff[i % staff.length] : assignTo && !["unassigned", "distribute"].includes(assignTo) ? assignTo : null,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error, count } = await supabase.from("leads").insert(rows.slice(i, i + CHUNK), { count: "exact" });
    if (error) {
      return { error: `Import stopped after ${inserted} leads: ${error.message}` };
    }
    inserted += count ?? 0;
  }
  await audit(s, "leads.import", "project", projectId, { inserted, rejected: result.rejected.length });
  revalidatePath("/leads");
  return { done: true, inserted, rejected: result.rejected, optedOut: result.summary.optedOut, consentUnknown: result.summary.consentUnknown };
}

export async function updateLead(form: FormData) {
  const s = await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const status = String(form.get("status") ?? "");
  const notes = String(form.get("notes") ?? "");
  const followUp = String(form.get("next_follow_up_at") ?? "");
  if (!(MANUAL_STATUSES as readonly string[]).includes(status)) return;

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status, notes: notes || null, next_follow_up_at: followUp ? new Date(followUp).toISOString() : null };
  const { data, error } = await supabase.from("leads").update(patch).eq("id", id).select("id").maybeSingle();
  if (error || !data) return; // RLS: not your lead
  await supabase.from("lead_activities").insert({
    org_id: s.orgId!, lead_id: id, actor_id: s.userId, kind: "update", payload: { notes: notes || null, next_follow_up_at: patch.next_follow_up_at },
  });
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

export async function addNote(form: FormData) {
  const s = await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const note = String(form.get("note") ?? "").trim();
  if (!note) return;
  const supabase = await createClient();
  const { data } = await supabase.from("leads").select("id").eq("id", id).maybeSingle();
  if (!data) return;
  await supabase.from("lead_activities").insert({ org_id: s.orgId!, lead_id: id, actor_id: s.userId, kind: "note", payload: { note } });
  await supabase.from("leads").update({ last_interaction_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/leads/${id}`);
}

export async function assignLead(form: FormData) {
  const s = await requireRole("partner_admin");
  const id = String(form.get("id"));
  const to = String(form.get("assigned_to") ?? "");
  const supabase = await createClient();
  if (to) {
    const { data: emp } = await supabase.from("profiles").select("id").eq("id", to).eq("is_active", true).maybeSingle();
    if (!emp) return;
  }
  const { error } = await supabase.from("leads").update({ assigned_to: to || null }).eq("id", id);
  if (error) return;
  await supabase.from("lead_activities").insert({ org_id: s.orgId!, lead_id: id, actor_id: s.userId, kind: "assigned", payload: { assigned_to: to || null } });
  await audit(s, "lead.assign", "lead", id, { assigned_to: to || null });
  revalidatePath(`/leads/${id}`);
}

/** Records an opt-out: a database trigger then flips the lead to do-not-contact and denied consent. */
export async function recordOptOut(form: FormData) {
  const s = await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("phone").eq("id", id).maybeSingle();
  if (!lead) return;
  await supabase.from("opt_outs").upsert({ org_id: s.orgId!, phone: lead.phone, reason: "recorded by staff" }, { onConflict: "org_id,phone", ignoreDuplicates: true });
  await audit(s, "lead.opt_out", "lead", id);
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

export async function createCallback(form: FormData) {
  const s = await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const due = String(form.get("due_at") ?? "");
  const notes = String(form.get("notes") ?? "");
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("id, assigned_to").eq("id", id).maybeSingle();
  if (!lead) return;
  await supabase.from("callback_tasks").insert({
    org_id: s.orgId!, lead_id: id, assigned_to: lead.assigned_to ?? s.userId, due_at: due ? new Date(due).toISOString() : null, notes: notes || null,
  });
  revalidatePath(`/leads/${id}`);
  revalidatePath("/tasks");
}

export async function requestVisit(form: FormData) {
  const s = await requireRole("partner_admin", "partner_employee");
  const id = String(form.get("id"));
  const preferred = String(form.get("preferred_at") ?? "");
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("id, project_id, status").eq("id", id).maybeSingle();
  if (!lead) return;
  const { error } = await supabase.from("site_visits").insert({
    org_id: s.orgId!, lead_id: id, project_id: lead.project_id, preferred_at: preferred ? new Date(preferred).toISOString() : null, status: "requested",
  });
  if (error) return;
  await supabase.from("leads").update({ status: "visit_requested" }).eq("id", id);
  revalidatePath(`/leads/${id}`);
  revalidatePath("/visits");
}
