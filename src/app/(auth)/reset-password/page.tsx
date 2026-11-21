import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { createClient } from "@/lib/supabase/server";
import { setNewPassword } from "../actions";

export default async function ResetPasswordPage() {
  // Reached only through a verified email link, which establishes a session.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/forgot-password?error=expired-link");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Choose a new password</h1>
      <p className="mb-4 text-sm text-slate-600">Use at least 10 characters.</p>
      <AuthForm
        action={setNewPassword}
        submit="Save password"
        fields={[
          { name: "password", label: "New password", type: "password", autoComplete: "new-password" },
          { name: "confirm", label: "Confirm password", type: "password", autoComplete: "new-password" },
        ]}
      />
    </>
  );
}
