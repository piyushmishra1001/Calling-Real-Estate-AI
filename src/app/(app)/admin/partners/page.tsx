import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/simple-form";
import { Badge, Card, PageHeader, btnDanger, btnGhost, input, label, pretty } from "@/components/ui";
import { PLAN_PRESETS } from "@/lib/plans";
import { createPartner, reinvitePartnerAdmin, setPartnerStatus, updateEntitlements } from "../actions";

export default async function PartnersPage() {
  await requireRole("super_admin");
  const supabase = await createClient();
  const [{ data: orgs }, { data: ents }, { data: profiles }] = await Promise.all([
    supabase.from("organizations").select("id, name, status").order("created_at", { ascending: false }),
    supabase.from("org_entitlements").select("*"),
    supabase.from("profiles").select("org_id, role, email, is_active"),
  ]);
  const entBy = new Map((ents ?? []).map((e) => [e.org_id, e]));
  return (
    <>
      <PageHeader title="Partners" subtitle="Create partner organisations, set their limits and suspend access. Only you can change limits." />
      <Card title="Add a partner">
        <ActionForm action={createPartner} submit="Create and invite" className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div><label className={label}>Partner name</label><input name="name" required className={input} /></div>
          <div><label className={label}>Partner Admin email</label><input name="admin_email" type="email" required className={input} /></div>
          <div><label className={label}>Plan</label>
            <select name="plan" className={input} defaultValue="crm">{Object.entries(PLAN_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}{p.priceInr ? ` · ₹${p.priceInr.toLocaleString("en-IN")}/mo` : ""}</option>)}</select></div>
        </ActionForm>
      </Card>
      <div className="mt-6 space-y-4">
        {(orgs ?? []).map((o) => {
          const e = entBy.get(o.id);
          const members = (profiles ?? []).filter((p) => p.org_id === o.id);
          const admins = members.filter((m) => m.role === "partner_admin");
          return (
            <Card key={o.id} title={o.name} action={<Badge tone={o.status === "active" ? "green" : "red"}>{pretty(o.status)}</Badge>}>
              <p className="mb-3 text-xs text-slate-500">{members.filter((m) => m.is_active).length} active users · Admin: {admins.map((a) => a.email).join(", ") || "not yet accepted"}</p>
              {e && (
                <ActionForm action={updateEntitlements} submit="Save limits" className="grid gap-3 sm:grid-cols-5 sm:items-end">
                  <input type="hidden" name="org_id" value={o.id} />
                  <div><label className={label}>Plan</label><select name="plan" defaultValue={e.plan} className={input}>{Object.entries(PLAN_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></div>
                  <div><label className={label}>Monthly minutes</label><input name="monthly_minute_limit" type="number" min={0} defaultValue={e.monthly_minute_limit} className={input} /></div>
                  <div><label className={label}>Daily calls</label><input name="daily_call_limit" type="number" min={0} defaultValue={e.daily_call_limit} className={input} /></div>
                  <div><label className={label}>Seats</label><input name="seats" type="number" min={1} defaultValue={e.seats} className={input} /></div>
                </ActionForm>
              )}
              <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-slate-100 pt-3">
                <form action={setPartnerStatus}><input type="hidden" name="id" value={o.id} />
                  {o.status === "active" ? <button name="status" value="suspended" className={btnDanger}>Suspend</button> : <button name="status" value="active" className={btnGhost}>Reactivate</button>}</form>
                <ActionForm action={reinvitePartnerAdmin} submit="Invite admin" className="flex items-center gap-2"><input type="hidden" name="org_id" value={o.id} /><input name="email" type="email" placeholder="admin@partner.com" className={input + " w-56"} /></ActionForm>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
