import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "./supabase/admin";
import { actionEmail, emailConfigured, sendEmail } from "./email";

export async function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export type InviteResult = { ok: true; invitationId: string } | { ok: false; error: string };

/**
 * Invitation-only onboarding. The invitation row is created FIRST (the database trigger reads it when
 * the auth user appears and derives org + role from it), then Supabase emails the link. If the email
 * cannot be sent, the invitation is removed so nothing dangles.
 */
export async function inviteUser(args: { orgId: string; email: string; role: "partner_admin" | "partner_employee"; invitedBy: string }): Promise<InviteResult> {
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  const admin = createAdminClient();

  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return { ok: false, error: "That person already has an account." };

  // Replace any earlier pending invitation for this address and organisation.
  await admin.from("invitations").delete().eq("org_id", args.orgId).ilike("email", email).is("accepted_at", null);

  const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const { data: inv, error } = await admin
    .from("invitations")
    .insert({ org_id: args.orgId, email, role: args.role, token_hash: tokenHash, invited_by: args.invitedBy })
    .select("id")
    .single();
  if (error || !inv) return { ok: false, error: error?.message ?? "Could not create the invitation." };

  const redirectTo = `${await siteUrl()}/auth/callback?next=/reset-password`;
  if (emailConfigured()) {
    // Create the login and its link ourselves, then send the email through our own provider.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
    const url = link?.properties?.action_link;
    if (linkError || !url) {
      await admin.from("invitations").delete().eq("id", inv.id);
      return { ok: false, error: `Could not create the invitation: ${linkError?.message ?? "no link"}` };
    }
    const mail = actionEmail({
      heading: "You've been invited to LeadPilot AI",
      intro: "Set a password to finish creating your account.",
      button: "Accept invitation",
      url,
      footer: "If you weren't expecting this invitation, you can ignore this email.",
    });
    const sent = await sendEmail({ to: email, subject: "You're invited to LeadPilot AI", ...mail });
    if (!sent.ok) {
      await admin.from("invitations").delete().eq("id", inv.id);
      if (link?.user?.id) await admin.auth.admin.deleteUser(link.user.id);
      return { ok: false, error: `Could not send the invitation: ${sent.error}` };
    }
    return { ok: true, invitationId: inv.id };
  }

  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (mailError) {
    await admin.from("invitations").delete().eq("id", inv.id);
    return { ok: false, error: `Could not send the invitation: ${mailError.message}` };
  }
  return { ok: true, invitationId: inv.id };
}
