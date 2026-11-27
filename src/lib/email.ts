import "server-only";

export type MailResult = { ok: true } | { ok: false; error: string };

export const emailConfigured = () => !!process.env.RESEND_API_KEY;

const FROM = () => process.env.EMAIL_FROM || "LeadPilot AI <onboarding@resend.dev>";

/** Sends one transactional email through Resend. The API key stays on the server. */
export async function sendEmail(args: { to: string; subject: string; html: string; text: string }): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email is not configured." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [args.to], subject: args.subject, html: args.html, text: args.text }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    console.error(`[email] resend failed: status=${res.status} message=${body.message}`);
    return { ok: false, error: body.message ?? `Email provider returned ${res.status}.` };
  } catch (e) {
    console.error("[email] resend request failed", e);
    return { ok: false, error: "Could not reach the email provider." };
  }
}

/** A plain, accessible single-button email. */
export function actionEmail(args: { heading: string; intro: string; button: string; url: string; footer: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:Inter,Arial,sans-serif;color:#0e121b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid #e1e4ea;border-radius:16px">
<tr><td style="padding:32px">
<div style="font-weight:600;color:#1e3a8a;margin-bottom:20px">LeadPilot AI</div>
<h1 style="font-size:20px;margin:0 0 12px">${args.heading}</h1>
<p style="font-size:15px;line-height:22px;margin:0 0 24px;color:#525866">${args.intro}</p>
<a href="${args.url}" style="display:inline-block;background:#1e3a8a;color:#fff;text-decoration:none;font-weight:500;font-size:15px;padding:12px 20px;border-radius:10px">${args.button}</a>
<p style="font-size:13px;line-height:20px;margin:24px 0 0;color:#6b7280">${args.footer}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${args.heading}\n\n${args.intro}\n\n${args.button}: ${args.url}\n\n${args.footer}`;
  return { html, text };
}
