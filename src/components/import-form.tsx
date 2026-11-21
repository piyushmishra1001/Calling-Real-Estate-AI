"use client";

import { useActionState, useState } from "react";
import { parseLeadCsv, type ImportResult } from "@/lib/csv-import";
import { Badge, Card, Notice, btn, input, label } from "./ui";
import { importLeads, type ImportState } from "@/app/(app)/leads/actions";

type Opt = { id: string; name: string };

export function ImportForm({ projects, employees }: { projects: Opt[]; employees: Opt[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importLeads, undefined);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    setFileName(f.name);
    setPreview(parseLeadCsv(text)); // format check only; the server re-validates against existing leads and opt-outs
  }

  return (
    <div className="space-y-4">
      <Card>
        <form action={action} className="space-y-4">
          <input type="hidden" name="csv" value={csv} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="project_id">Project</label>
              <select id="project_id" name="project_id" required className={input}>
                <option value="">Select a project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="assign_to">Assign to</label>
              <select id="assign_to" name="assign_to" className={input} defaultValue="unassigned">
                <option value="unassigned">Leave unassigned</option>
                <option value="distribute">Distribute evenly across employees</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="file">CSV file</label>
            <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm" />
            <p className="mt-1 text-xs text-slate-500">Columns: Name and Phone are required. Optional: Email, Source, Type, Configuration, Location, Budget, Timeline, Consent. Up to 5,000 rows.</p>
          </div>
          {preview && !preview.fatal && (
            <Notice tone="blue">
              {fileName}: {preview.summary.valid} look valid, {preview.summary.rejected} rejected, {preview.summary.consentUnknown} with no recorded consent.
              Leads without recorded consent are imported but will <strong>not</strong> be called.
            </Notice>
          )}
          {preview?.fatal && <Notice tone="red">{preview.fatal}</Notice>}
          {state && "error" in state && <Notice tone="red">{state.error}</Notice>}
          <button className={btn} disabled={pending || !csv || !!preview?.fatal}>{pending ? "Importing…" : "Import leads"}</button>
        </form>
      </Card>

      {state && "done" in state && (
        <Card title="Import result">
          <p className="text-sm"><strong>{state.inserted}</strong> leads imported. {state.optedOut > 0 && <>{state.optedOut} were already on your opt-out list and are marked do-not-contact. </>}{state.consentUnknown > 0 && <>{state.consentUnknown} have no recorded consent.</>}</p>
          {state.rejected.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">Rejected rows <Badge tone="red">{state.rejected.length}</Badge></div>
              <div className="max-h-64 overflow-auto rounded border border-slate-200">
                <table className="w-full text-xs"><thead className="bg-slate-50 text-left"><tr><th className="p-2">Row</th><th>Reason</th></tr></thead>
                  <tbody>{state.rejected.slice(0, 200).map((r) => <tr key={r.row} className="border-t"><td className="p-2">{r.row}</td><td>{r.reason}</td></tr>)}</tbody>
                </table>
              </div>
              {state.rejected.length > 200 && <p className="mt-1 text-xs text-slate-500">Showing the first 200.</p>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
