import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { Notice } from "@/components/ui";
import { signIn } from "../actions";
import { safeNextPath } from "@/lib/safe-redirect";

const MESSAGES: Record<string, string> = {
  "invalid-link": "That link is invalid. Request a new one.",
  "no-access": "Your account has no access. It may be suspended or not yet invited.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const code = String(sp.error ?? sp.reason ?? "");
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null, "");
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      {MESSAGES[code] && <div className="mb-4"><Notice>{MESSAGES[code]}</Notice></div>}
      <AuthForm
        action={signIn}
        submit="Sign in"
        hidden={next ? { next } : {}}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      <div className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-indigo-600 hover:underline">Forgot your password?</Link>
      </div>
    </>
  );
}
