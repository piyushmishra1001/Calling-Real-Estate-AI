"use client";

import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Finishes email-link sign-ins: invitations and password resets.
 * Supabase's standard link comes back with the session in the URL fragment (#access_token=...),
 * which only the browser can read. Other link styles (?code= or ?token_hash=) are handled too.
 */
export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const type = hash.get("type") ?? query.get("type");
      const needsPassword = type === "invite" || type === "recovery" || query.get("next") === "/reset-password";
      const next = safeNextPath(query.get("next"), needsPassword ? "/reset-password" : "/dashboard");
      const fail = (reason: string) => window.location.replace(`/forgot-password?error=${reason}`);

      if (hash.get("error") || query.get("error")) return fail("expired-link");

      const supabase = createBrowserSupabase();
      let error: unknown = null;

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = query.get("code");
      const tokenHash = query.get("token_hash");

      if (accessToken && refreshToken) {
        ({ error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
      } else if (code) {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      } else if (tokenHash && type) {
        ({ error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash }));
      } else {
        error = new Error("no token");
      }

      if (cancelled) return;
      if (error) {
        setFailed(true);
        return fail("expired-link");
      }
      // A full page load, so the server sees the new session cookies.
      window.location.replace(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-default)] bg-white p-6 text-center shadow-[var(--shadow-xs)]">
        <div className="text-xl font-semibold tracking-tight text-[var(--brand)]">LeadPilot AI</div>
        <p className="mt-3 text-sm text-[var(--text-body)]">{failed ? "That link has expired. Redirecting…" : "Signing you in…"}</p>
      </div>
    </main>
  );
}
