import type { ReactNode } from "react";

const BTN = "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-4 text-sm font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed";
export const btn =
  BTN + " border-transparent bg-[var(--primary-cta-button)] text-white shadow-[var(--shadow-button-primary)] hover:bg-[var(--brand-hover)] disabled:bg-[var(--bg-soft-200)] disabled:text-[var(--text-disabled)] disabled:shadow-none";
export const btnGhost =
  BTN + " border-[var(--border-default)] bg-white text-[var(--text-title)] shadow-[var(--shadow-xs)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]";
export const btnDanger =
  BTN + " border-transparent bg-[var(--state-error-base)] text-white shadow-[var(--shadow-button-primary)] hover:bg-[var(--red-900)] disabled:opacity-50";
export const input =
  "block h-10 w-full rounded-[10px] border border-[var(--border-default)] bg-white px-3 text-sm text-[var(--text-title)] shadow-[var(--shadow-xs)] placeholder:text-[var(--text-soft-400)] focus:border-[var(--brand-accent)] focus:outline-none focus:shadow-[var(--ring-primary)]";
export const label = "mb-1.5 block text-sm font-medium text-[var(--text-title)]";

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border-default)] bg-white shadow-[var(--shadow-xs)]">
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label: l, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-white p-5 shadow-[var(--shadow-xs)]">
      <div className="text-xs font-medium uppercase tracking-[0.06em] text-[var(--text-body)]">{l}</div>
      <div className="figure mt-1.5 text-[28px] font-semibold leading-9 tracking-tight text-[var(--text-title)]">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex h-[22px] items-center rounded-full px-2 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "green" | "blue"; children: ReactNode }) {
  return <div className={`rounded-[10px] px-3.5 py-2.5 text-sm [overflow-wrap:anywhere] ring-1 ring-inset ${TONES[tone]}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[24px] font-semibold leading-8 tracking-tight text-[var(--text-title)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export const LEAD_TONE: Record<string, keyof typeof TONES> = {
  new: "slate", queued: "slate", calling: "blue", connected: "blue", interested: "green",
  callback_requested: "amber", visit_requested: "amber", visit_confirmed: "green", visit_attended: "green",
  not_interested: "slate", wrong_number: "red", do_not_contact: "red",
};

export const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
