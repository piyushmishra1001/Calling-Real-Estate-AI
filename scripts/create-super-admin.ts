/**
 * One-off bootstrap: creates the first Super Admin (there is no public signup, so someone has to exist).
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-super-admin.ts you@example.com 'a-long-password'
 * Run it from your own machine. The service-role key never goes in the browser or the repo.
 */
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !password || !url || !key) {
  console.error("Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx scripts/create-super-admin.ts <email> <password>");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) {
  console.error("Could not create the auth user:", error?.message);
  process.exit(1);
}
const { error: pErr } = await admin.from("profiles").insert({ id: data.user.id, role: "super_admin", org_id: null, email, full_name: "Super Admin" });
if (pErr) {
  console.error("Auth user created but the profile failed:", pErr.message);
  process.exit(1);
}
console.log(`Super Admin created: ${email}`);
