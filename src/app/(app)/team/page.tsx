import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/simple-form";
import { Badge, Card, Empty, PageHeader, btnGhost, input, label, pretty } from "@/components/ui";
import { dt } from "@/lib/format";
import { inviteEmployee, setEmployeeActive } from "./actions";

export default async function TeamPage() {
  const s = await requireRole("partner_admin");
  const supabase = await createClient();
  const [{ data: members }, { data: invites }, { data: ent }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, is_active").order("created_at"),
    supabase.from("invitations").select("id, email, expires_at, accepted_at").is("accepted_at", null),
    supabase.from("org_entitlements").select("seats, plan").eq("org_id", s.orgId!).maybeSingle(),
  ]);
  const active = (members ?? []).filter((m) => m.is_active).length;
  return (
    <>
      <PageHeader title="Team" subtitle={`${active} of ${ent?.seats ?? "—"} seats used on the ${ent?.plan ?? ""} plan.`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Members">
            <ul className="divide-y divide-slate-100 text-sm">
              {(members ?? []).map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <div><div className="font-medium">{m.full_name ?? m.email}</div><div className="text-xs text-slate-500">{m.email} · {pretty(m.role)}</div></div>
                  <div className="flex items-center gap-2">
                    <Badge tone={m.is_active ? "green" : "slate"}>{m.is_active ? "Active" : "Deactivated"}</Badge>
                    {m.role === "partner_employee" && (
                      <form action={setEmployeeActive}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="active" value={String(!m.is_active)} />
                        <button className={btnGhost}>{m.is_active ? "Deactivate" : "Reactivate"}</button></form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <div className="mt-4"><Card title="Pending invitations">
            {(invites ?? []).length === 0 ? <Empty>None.</Empty> : (
              <ul className="text-sm">{invites!.map((i) => <li key={i.id} className="flex justify-between py-1"><span>{i.email}</span><span className="text-slate-500">expires {dt(i.expires_at)}</span></li>)}</ul>
            )}
          </Card></div>
        </div>
        <Card title="Invite an employee">
          <ActionForm action={inviteEmployee} submit="Send invitation">
            <div><label className={label} htmlFor="email">Email</label><input id="email" name="email" type="email" required className={input} /></div>
            <p className="text-xs text-slate-500">They get an email link to set a password. Employees see only the leads assigned to them.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
