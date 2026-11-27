"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUser } from "@/lib/invite";
import { PLAN_PRESETS } from "@/lib/plans";

export type AdminState = { error?: string; message?: string } | undefined;

export async function createPartner(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireRole("super_admin");
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("admin_email") ?? "").trim();
  const plan = String(form.get("plan") ?? "crm");
  if (!name) return { error: "Enter the partner's name." };
  if (!email) return { error: "Enter the Partner Admin's email." };
  const preset = PLAN_PRESETS[plan];
  if (!preset) return { error: "Unknown plan." };

  const supabase = await createClient();
  const { data: org, error } = await supabase.from("organizations").insert({ name }).select("id").single();
  if (error || !org) return { error: error?.message ?? "Could not create the partner." };
  await supabase.from("org_entitlements").update({ plan, included_minutes: preset.minutes, seats: preset.seats, monthly_minute_limit: preset.minutes, daily_call_limit: preset.dailyCalls }).eq("org_id", org.id);

  const r = await inviteUser({ orgId: org.id, email, role: "partner_admin", invitedBy: s.userId, shareLinkIfEmailFails: true });
  await audit(s, "partner.create", "organization", org.id, { name, plan, invited: r.ok });
  revalidatePath("/admin/partners");
  if (!r.ok) return { error: `Partner created, but the invitation failed: ${r.error} You can re-invite from the partner row.` };
  if (r.link) return { message: `${name} created. The email could not be sent, so send ${email} this invitation link yourself (it works once): ${r.link}` };
  return { message: `${name} created and ${email} invited as Partner Admin.` };
}

export async function reinvitePartnerAdmin(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireRole("super_admin");
  const orgId = String(form.get("org_id"));
  const r = await inviteUser({ orgId, email: String(form.get("email") ?? ""), role: "partner_admin", invitedBy: s.userId, shareLinkIfEmailFails: true });
  if (!r.ok) return { error: r.error };
  await audit(s, "partner.invite_admin", "organization", orgId, { emailed: !r.link });
  revalidatePath("/admin/partners");
  if (r.link) return { message: `The email could not be sent, so send them this invitation link yourself (it works once): ${r.link}` };
  return { message: "Invitation sent." };
}

export async function setPartnerStatus(form: FormData) {
  const s = await requireRole("super_admin");
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  if (!["active", "suspended", "deactivated"].includes(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ status }).eq("id", id);
  if (error) return;
  if (status !== "active") {
    // Stop anything running for a partner that is no longer active.
    const admin = createAdminClient();
    await admin.from("campaigns").update({ status: "stopped", stopped_by: s.userId }).eq("org_id", id).in("status", ["running", "paused", "draft"]);
  }
  await audit(s, `partner.${status}`, "organization", id);
  revalidatePath("/admin/partners");
}

export async function updateEntitlements(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireRole("super_admin");
  const orgId = String(form.get("org_id"));
  const n = (k: string) => Math.max(0, Math.floor(Number(form.get(k)) || 0));
  const patch = { plan: String(form.get("plan") ?? "crm"), included_minutes: n("monthly_minute_limit"), monthly_minute_limit: n("monthly_minute_limit"), daily_call_limit: n("daily_call_limit"), seats: Math.max(1, n("seats")), updated_at: new Date().toISOString() };
  const supabase = await createClient();
  const { error } = await supabase.from("org_entitlements").update(patch).eq("org_id", orgId);
  if (error) return { error: error.message };
  await audit(s, "entitlements.update", "organization", orgId, patch);
  revalidatePath("/admin/partners");
  return { message: "Saved." };
}

export async function setKillSwitch(form: FormData) {
  const s = await requireRole("super_admin");
  const on = String(form.get("on")) === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("platform_settings").update({ calling_kill_switch: on, updated_by: s.userId, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return;
  await audit(s, on ? "kill_switch.on" : "kill_switch.off", "platform", "1");
  revalidatePath("/", "layout");
}

export async function stopAnyCampaign(form: FormData) {
  const s = await requireRole("super_admin");
  const id = String(form.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ status: "stopped" }).eq("id", id); // stopped_by is set by a database trigger
  if (error) return;
  // Releasing queued leads touches partner data, which the super admin cannot do directly: use the service role, narrowly.
  const admin = createAdminClient();
  const { data: queued } = await admin.from("campaign_leads").select("lead_id").eq("campaign_id", id).eq("state", "queued");
  const ids = (queued ?? []).map((q) => q.lead_id);
  if (ids.length) await admin.from("leads").update({ status: "new" }).in("id", ids).eq("status", "queued");
  await admin.from("campaign_leads").update({ state: "cancelled" }).eq("campaign_id", id).eq("state", "queued");
  await audit(s, "campaign.stop_by_admin", "campaign", id);
  revalidatePath("/admin/calling");
}

// ---------------------------------------------------------------- projects and knowledge base
const list = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function createProject(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireRole("super_admin");
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Enter a project name." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").insert({
    name, developer: String(form.get("developer") ?? "") || null, location: String(form.get("location") ?? "") || null,
    category: String(form.get("category") ?? "") || null, configurations: list(form.get("configurations")),
    possession: String(form.get("possession") ?? "") || null, site_visit_address: String(form.get("site_visit_address") ?? "") || null, created_by: s.userId,
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not create the project." };
  await audit(s, "project.create", "project", data.id, { name });
  redirect(`/admin/projects/${data.id}`);
}

export async function setAssignment(form: FormData) {
  const s = await requireRole("super_admin");
  const projectId = String(form.get("project_id"));
  const orgId = String(form.get("org_id"));
  const assign = String(form.get("assign")) === "true";
  const supabase = await createClient();
  const { error } = assign
    ? await supabase.from("project_assignments").upsert({ project_id: projectId, org_id: orgId }, { onConflict: "project_id,org_id", ignoreDuplicates: true })
    : await supabase.from("project_assignments").delete().eq("project_id", projectId).eq("org_id", orgId);
  if (error) return;
  await audit(s, assign ? "project.assign" : "project.unassign", "project", projectId, { orgId });
  revalidatePath(`/admin/projects/${projectId}`);
}

const FACT_FIELDS = ["location", "configurations", "pricing", "paymentPlans", "possession", "amenities", "connectivity", "siteVisitAddress"] as const;

/** Creates a new DRAFT knowledge-base version from what a person typed in. Nothing is auto-approved. */
export async function createKbDraft(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireRole("super_admin");
  const projectId = String(form.get("project_id"));
  const facts: Record<string, string> = {};
  for (const f of FACT_FIELDS) {
    const v = String(form.get(f) ?? "").trim();
    if (v) facts[f] = v;
  }
  if (Object.keys(facts).length === 0) return { error: "Enter at least one verified fact." };
  const faqs = String(form.get("faqs") ?? "").split("\n").map((l) => l.split("|")).filter((p) => p.length >= 2 && p[0].trim() && p.slice(1).join("|").trim()).map((p) => ({ q: p[0].trim(), a: p.slice(1).join("|").trim() }));

  const supabase = await createClient();
  const { data: last } = await supabase.from("project_kb_versions").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("project_kb_versions").insert({
    project_id: projectId, version: (last?.version ?? 0) + 1, facts, faqs, status: "draft", source_document: String(form.get("source") ?? "") || "entered manually",
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not save." };
  await audit(s, "kb.draft", "project_kb_versions", data.id, { projectId });
  revalidatePath(`/admin/projects/${projectId}`);
  return { message: "Draft saved. Submit it for review when the facts are checked against the source." };
}

export async function submitKbForReview(form: FormData) {
  const s = await requireRole("super_admin");
  const id = String(form.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("project_kb_versions").update({ status: "pending_review" }).eq("id", id).eq("status", "draft");
  if (error) return;
  await audit(s, "kb.submit", "project_kb_versions", id);
  revalidatePath("/admin/projects/[id]", "page");
}

export async function decideKb(form: FormData) {
  await requireRole("super_admin");
  const id = String(form.get("id"));
  const decision = String(form.get("decision"));
  const supabase = await createClient();
  // The database function records the reviewer, supersedes the old version and writes the audit row atomically.
  await supabase.rpc(decision === "approve" ? "approve_kb_version" : "reject_kb_version", { p_id: id });
  revalidatePath("/admin/projects/[id]", "page");
}

const PARTNER_TABLES = ["calls", "campaign_leads", "site_visits", "callback_tasks", "lead_activities", "leads", "opt_outs", "campaigns", "invitations"] as const;

/** Permanently deletes a partner: its data, its login accounts and the organisation. Super Admin only; the UI asks to confirm. */
export async function deletePartner(form: FormData) {
  const s = await requireRole("super_admin");
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id, name").eq("id", id).maybeSingle();
  if (!org) { revalidatePath("/admin/partners"); return; }

  const admin = createAdminClient();
  let userIds: string[] = [];
  let failure: string | null = null;

  // Preferred: one database function. Fallback: the same deletes, in order, so it works before migration 0006 is run.
  const rpc = await admin.rpc("delete_partner_data", { p_org: org.id });
  if (!rpc.error) {
    userIds = (rpc.data as { user_ids?: string[] } | null)?.user_ids ?? [];
  } else {
    const { data: members } = await admin.from("profiles").select("id").eq("org_id", org.id);
    userIds = (members ?? []).map((m) => m.id);
    for (const t of PARTNER_TABLES) {
      const { error } = await admin.from(t).delete().eq("org_id", org.id);
      if (error) { failure = `${t}: ${error.message}`; break; }
    }
    if (!failure) {
      const r1 = await admin.from("profiles").delete().eq("org_id", org.id);
      const r2 = r1.error ? r1 : await admin.from("organizations").delete().eq("id", org.id);
      if (r2.error) failure = r2.error.message;
    }
  }
  if (failure) redirect(`/admin/partners?error=${encodeURIComponent("Could not delete this partner: " + failure)}`);

  // Remove the login accounts too, so the same emails can be invited again.
  for (const uid of userIds) await admin.auth.admin.deleteUser(uid);
  await audit(s, "partner.delete", "organization", org.id, { name: org.name, users_removed: userIds.length });
  revalidatePath("/admin/partners");
  redirect("/admin/partners");
}
