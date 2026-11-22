import { createBrowserClient } from "@supabase/ssr";

/** Browser client, used only to finish email-link sign-ins (the token arrives in the URL fragment, which servers never see). */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
