import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-[var(--brand)]">LeadPilot AI</div>
          <p className="mt-2 text-sm text-[var(--text-body)]">Real estate lead-conversion platform</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-default)] bg-white p-6 shadow-[var(--shadow-xs)]">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-500">Access is by invitation only.</p>
      </div>
    </main>
  );
}
