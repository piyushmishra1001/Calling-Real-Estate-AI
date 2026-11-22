import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

export type Role = "super_admin" | "partner_admin" | "partner_employee";

export type Session = {
  userId: string;
  email: string;
  role: Role;
  orgId: string | null;
  orgName: string | null;
  fullName: string | null;
  /** True when the partner's plan includes AI calling. CRM-only plans have no minutes. */
  callingEnabled: boolean;
};

/**
 * Reads who the user is from the database (never from client-supplied data). Null when not usable.
 * Cached per request: the layout and the page both call it, but it only hits the network once.
 * The token is verified by signature (getClaims) rather than a network call; the profile query below
 * still runs on every request, so deactivating a user or suspending a partner takes effect at once.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const t0 = Date.now();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const t1 = Date.now();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, org_id, full_name, email, is_active, organizations(name, status, org_entitlements(monthly_minute_limit))")
    .eq("id", userId)
    .maybeSingle();
  console.info(`[perf] getSession claims=${t1 - t0}ms profile=${Date.now() - t1}ms`);
  if (!profile || !profile.is_active) return null;

  let orgName: string | null = null;
  let callingEnabled = true; // Super admins have no plan of their own.
  if (profile.org_id) {
    const org = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations;
    // A suspended or deactivated partner has no usable session at all.
    if (!org || org.status !== "active") return null;
    orgName = org.name;
    const ent = Array.isArray(org.org_entitlements) ? org.org_entitlements[0] : org.org_entitlements;
    callingEnabled = Number(ent?.monthly_minute_limit ?? 0) > 0;
  }
  return {
    userId: profile.id,
    email: profile.email ?? (typeof auth?.claims?.email === "string" ? auth.claims.email : ""),
    role: profile.role as Role,
    orgId: profile.org_id,
    orgName,
    fullName: profile.full_name,
    callingEnabled,
  };
});

/** Server-side authorisation gate. Every page and action calls this; UI visibility is never the control. */
export async function requireRole(...allowed: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login?reason=no-access");
  if (!allowed.includes(s.role)) redirect("/dashboard");
  return s;
}

/** Gate for AI-calling features. CRM-only partners are sent back to the dashboard. */
export async function requireCalling(...allowed: Role[]): Promise<Session> {
  const s = await requireRole(...allowed);
  if (!s.callingEnabled) redirect("/dashboard");
  return s;
}

export const isPartner = (s: Session) => s.role === "partner_admin" || s.role === "partner_employee";

/** Append-only audit trail, written with the service role because users cannot write it. */
export async function audit(
  s: Pick<Session, "userId" | "orgId">,
  action: string,
  entity: string,
  entityId: string | null,
  payload: Record<string, unknown> = {},
) {
  try {
    await createAdminClient().from("audit_logs").insert({
      actor_id: s.userId,
      org_id: s.orgId,
      action,
      entity,
      entity_id: entityId,
      payload,
    });
  } catch (e) {
    console.error("audit log failed", action, e);
  }
}
