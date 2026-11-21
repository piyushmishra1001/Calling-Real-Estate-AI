import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Notice } from "@/components/ui";
import { requestPasswordReset } from "../actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-4 text-sm text-slate-600">We'll email you a link to choose a new one.</p>
      {sp.error === "expired-link" && <div className="mb-4"><Notice>That link has expired or was already used. Request a new one.</Notice></div>}
      <AuthForm action={requestPasswordReset} submit="Send reset link" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]} />
      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-indigo-600 hover:underline">Back to sign in</Link>
      </div>
    </>
  );
}
