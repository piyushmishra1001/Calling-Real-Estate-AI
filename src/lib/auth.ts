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
};

/**
 * Reads who the user is from the database (never from client-supplied data). Null when not usable.
 * Cached per request: the layout and the page both call it, but it only hits the network once.
 * The token is verified by signature (getClaims) rather than a network call; the profile query below
 * still runs on every request, so deactivating a user or suspending a partner takes effect at once.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, org_id, full_name, email, is_active, organizations(name, status)")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;

  let orgName: string | null = null;
  if (profile.org_id) {
    const org = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations;
    // A suspended or deactivated partner has no usable session at all.
    if (!org || org.status !== "active") return null;
    orgName = org.name;
  }
  return {
    userId: profile.id,
    email: profile.email ?? (typeof auth?.claims?.email === "string" ? auth.claims.email : ""),
    role: profile.role as Role,
    orgId: profile.org_id,
    orgName,
    fullName: profile.full_name,
  };
});

/** Server-side authorisation gate. Every page and action calls this; UI visibility is never the control. */
export async function requireRole(...allowed: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login?reason=no-access");
  if (!allowed.includes(s.role)) redirect("/dashboard");
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
