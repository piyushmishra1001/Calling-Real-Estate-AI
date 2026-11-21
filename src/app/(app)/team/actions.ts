"use server";

import { revalidatePath } from "next/cache";
import { audit, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { inviteUser } from "@/lib/invite";

export type TeamState = { error?: string; message?: string } | undefined;

export async function inviteEmployee(_: TeamState, form: FormData): Promise<TeamState> {
  const s = await requireRole("partner_admin");
  const supabase = await createClient();
  const [{ count: used }, { data: ent }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("org_entitlements").select("seats").eq("org_id", s.orgId!).maybeSingle(),
  ]);
  if (ent && (used ?? 0) >= ent.seats) return { error: `Your plan includes ${ent.seats} seats and all are in use. Ask LeadPilot to upgrade.` };

  const email = String(form.get("email") ?? "");
  const r = await inviteUser({ orgId: s.orgId!, email, role: "partner_employee", invitedBy: s.userId });
  if (!r.ok) return { error: r.error };
  await audit(s, "team.invite", "invitation", r.invitationId, { email, role: "partner_employee" });
  revalidatePath("/team");
  return { message: `Invitation sent to ${email}.` };
}

export async function setEmployeeActive(form: FormData) {
  const s = await requireRole("partner_admin");
  const id = String(form.get("id"));
  const active = String(form.get("active")) === "true";
  if (id === s.userId) return; // cannot deactivate yourself
  const supabase = await createClient();
  // RLS limits this to employees of the caller's own organisation.
  const { data, error } = await supabase.from("profiles").update({ is_active: active }).eq("id", id).eq("role", "partner_employee").select("id").maybeSingle();
  if (error || !data) return;
  await audit(s, active ? "team.activate" : "team.deactivate", "profile", id);
  revalidatePath("/team");
}
