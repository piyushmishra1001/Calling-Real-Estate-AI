import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, btn, btnGhost, input, pretty } from "@/components/ui";
import { dt, pct } from "@/lib/format";
import { updateVisit } from "./actions";

const TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = {
  requested: "amber", pending_confirmation: "amber", confirmed: "green", attended: "green", cancelled: "slate", rescheduled: "blue", no_show: "red",
};

export default async function VisitsPage() {
  await requireRole("partner_admin", "partner_employee");
  const supabase = await createClient();
  const { data: visits } = await supabase
    .from("site_visits")
    .select("id, status, preferred_at, scheduled_at, confirmation_source, leads(id, name, phone), projects(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  const all = visits ?? [];
  const n = (st: string[]) => all.filter((v) => st.includes(v.status)).length;
  const requested = all.length;
  const confirmed = n(["confirmed", "attended", "no_show"]);
  const attended = n(["attended"]);

  return (
    <>
      <PageHeader title="Site visits" subtitle="A visit is confirmed only when a coordinator reserves a slot here." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Badge>Requested: {requested}</Badge><Badge tone="green">Confirmed: {confirmed} ({pct(confirmed, requested)})</Badge><Badge tone="green">Attended: {attended} ({pct(attended, confirmed)} of confirmed)</Badge>
      </div>
      <Card>
        {all.length === 0 ? <Empty>No site visits yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {all.map((v) => {
              const lead = Array.isArray(v.leads) ? v.leads[0] : v.leads;
              const proj = Array.isArray(v.projects) ? v.projects[0] : v.projects;
              const open = ["requested", "pending_confirmation", "rescheduled"].includes(v.status);
              return (
                <li key={v.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link href={`/leads/${lead?.id}`} className="font-medium text-indigo-700">{lead?.name}</Link>
                      <span className="ml-2 text-sm text-slate-500">{proj?.name} · {lead?.phone}</span>
                      <div className="text-xs text-slate-500">{v.scheduled_at ? `Scheduled ${dt(v.scheduled_at)} (${v.confirmation_source})` : `Preferred ${dt(v.preferred_at)}`}</div>
                    </div>
                    <Badge tone={TONE[v.status] ?? "slate"}>{pretty(v.status)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(open || v.status === "confirmed") && (
                      <form action={updateVisit} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={v.id} />
                        <input type="datetime-local" name="scheduled_at" required className={input + " w-auto"} />
                        <button name="action" value={open ? "confirm" : "reschedule"} className={btn}>{open ? "Confirm slot" : "Reschedule"}</button>
                      </form>
                    )}
                    {v.status === "confirmed" && (
                      <form action={updateVisit} className="flex gap-2"><input type="hidden" name="id" value={v.id} />
                        <button name="action" value="attended" className={btnGhost}>Mark attended</button>
                        <button name="action" value="no_show" className={btnGhost}>No-show</button></form>
                    )}
                    {(open || v.status === "confirmed") && (
                      <form action={updateVisit}><input type="hidden" name="id" value={v.id} /><button name="action" value="cancel" className={btnGhost}>Cancel</button></form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
