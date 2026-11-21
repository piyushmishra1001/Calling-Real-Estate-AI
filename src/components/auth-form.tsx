"use client";

import { useActionState } from "react";
import { btn, input, label, Notice } from "./ui";
import type { FormState } from "@/app/(auth)/actions";

type Field = { name: string; label: string; type?: string; autoComplete?: string };

export function AuthForm({
  action, fields, submit, hidden = {},
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className={label}>{f.label}</label>
          <input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required className={input} />
        </div>
      ))}
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      {state?.message && <Notice tone="green">{state.message}</Notice>}
      <button type="submit" disabled={pending} className={`${btn} w-full`}>{pending ? "Please wait…" : submit}</button>
    </form>
  );
}
