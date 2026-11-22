"use client";

import { useFormStatus } from "react-dom";

function Trash({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-[10px] text-[var(--text-sub-600)] transition-colors hover:bg-[var(--state-error-lighter)] hover:text-[var(--state-error-base)] disabled:opacity-50"
    >
      <i className={pending ? "ri-loader-4-line animate-spin text-lg" : "ri-delete-bin-line text-lg"} aria-hidden />
    </button>
  );
}

/** A dustbin icon. Clicking it asks "are you sure?" and, on OK, runs the server action. */
export function DeleteButton({ action, id, confirm, label = "Delete" }: { action: (f: FormData) => Promise<void>; id: string; confirm: string; label?: string }) {
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(confirm)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <Trash label={label} />
    </form>
  );
}
