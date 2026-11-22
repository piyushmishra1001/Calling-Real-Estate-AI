import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

const TYPES: EmailOtpType[] = ["recovery", "invite", "magiclink", "signup", "email"];

/** Email links (password recovery, invitations) land here and exchange the token for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const isSetPassword = type === "recovery" || type === "invite";
  const next = safeNextPath(searchParams.get("next"), isSetPassword ? "/reset-password" : "/dashboard");

  if (!tokenHash || !type || !TYPES.includes(type)) {
    // Supabase's standard email link carries its token in the URL fragment, which a server cannot read.
    // Hand over to the browser page that can; the browser keeps the fragment across this redirect.
    return NextResponse.redirect(`${origin}/auth/callback${new URL(request.url).search}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired-link`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
