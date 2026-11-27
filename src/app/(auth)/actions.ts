"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionEmail, emailConfigured, sendEmail } from "@/lib/email";

export type FormState = { error?: string; message?: string } | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!EMAIL.test(email) || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Same message for wrong password and unknown email: do not reveal which accounts exist.
    return { error: "Incorrect email or password." };
  }
  redirect(safeNextPath(String(form.get("next") ?? ""), "/dashboard"));
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  const redirectTo = `${await siteUrl()}/auth/callback?next=/reset-password`;
  if (emailConfigured()) {
    // generateLink fails for unknown emails; we answer identically either way so accounts are not revealed.
    const { data, error: linkError } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    const url = data?.properties?.action_link;
    if (!linkError && url) {
      const mail = actionEmail({
        heading: "Reset your password",
        intro: "Use the button below to choose a new password. The link works once and expires soon.",
        button: "Choose a new password",
        url,
        footer: "If you didn't ask for this, you can ignore this email. Your password won't change.",
      });
      const sent = await sendEmail({ to: email, subject: "Reset your LeadPilot AI password", ...mail });
      if (!sent.ok) return { error: `We could not send the email: ${sent.error}` };
    }
    return { message: "If an account exists for that email, a reset link is on its way." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
  });
  if (error) {
    // Supabase does not report unknown emails as errors, so showing real failures does not reveal which accounts exist.
    console.error(`[auth] password reset failed: status=${error.status} code=${error.code} message=${error.message}`);
    if (error.status === 429 || error.code === "over_email_send_rate_limit") return { error: "Too many reset emails were requested. Wait a few minutes and try again." };
    return { error: "We could not send the email right now. The email service may be misconfigured; please contact support." };
  }
  // Identical response whether or not the account exists.
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function setNewPassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "This link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
