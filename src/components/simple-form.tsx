"use client";

import { useActionState, type ReactNode } from "react";
import { Notice, btn } from "./ui";

type State = { error?: string; message?: string } | undefined;

/** Generic client wrapper that shows a server action's error or success message. */
export function ActionForm({
  action, children, submit, className = "space-y-3",
}: {
  action: (s: State, f: FormData) => Promise<State>;
  children: ReactNode;
  submit: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      {state?.message && <Notice tone="green">{state.message}</Notice>}
      <button className={btn} disabled={pending}>{pending ? "Please wait…" : submit}</button>
    </form>
  );
}
