import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./server";

/**
 * Service-role client: BYPASSES RLS. Server-only (the "server-only" import fails the build if this
 * is ever pulled into client code). Use it only for what RLS deliberately forbids to users:
 * writing call records and audit logs, and inviting users. Always authorise the caller first.
 */
export function createAdminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
