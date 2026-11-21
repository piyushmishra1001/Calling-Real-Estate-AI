import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, btnGhost } from "@/components/ui";
import { dt, isPast } from "@/lib/format";
import { completeTask } from "../visits/actions";

export default async function TasksPage() {
  await requireRole("partner_admin", "partner_employee");
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("callback_tasks")
    .select("id, due_at, notes, leads(id, name, phone)")
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  return (
    <>
      <PageHeader title="Callbacks" subtitle="Customers waiting for a call from a person." />
      <Card>
        {(tasks ?? []).length === 0 ? <Empty>No open callbacks.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {tasks!.map((t) => {
              const l = Array.isArray(t.leads) ? t.leads[0] : t.leads;
              const overdue = isPast(t.due_at);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <Link href={`/leads/${l?.id}`} className="font-medium text-indigo-700">{l?.name}</Link>
                    <span className="ml-2 text-slate-500">{l?.phone}</span>
                    <div className={`text-xs ${overdue ? "text-red-600" : "text-slate-500"}`}>{dt(t.due_at)}{overdue ? " · overdue" : ""}{t.notes ? ` · ${t.notes}` : ""}</div>
                  </div>
                  <form action={completeTask}><input type="hidden" name="id" value={t.id} /><button className={btnGhost}>Mark done</button></form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
