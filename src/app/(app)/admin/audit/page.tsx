import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader } from "@/components/ui";
import { dt } from "@/lib/format";

export default async function AuditPage() {
  await requireRole("super_admin");
  const supabase = await createClient();
  const { data: logs } = await supabase.from("audit_logs").select("id, actor_id, org_id, action, entity, entity_id, payload, created_at").order("created_at", { ascending: false }).limit(200);
  const ids = [...new Set((logs ?? []).map((l) => l.actor_id).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, email").in("id", ids) : { data: [] };
  const email = new Map((people ?? []).map((p) => [p.id, p.email]));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Administrative actions across the platform, most recent first." />
      <Card>
        {(logs ?? []).length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th className="pb-2">When</th><th>Who</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>{logs!.map((l) => <tr key={l.id} className="border-t border-slate-100"><td className="py-1.5 whitespace-nowrap">{dt(l.created_at)}</td><td>{email.get(l.actor_id ?? "") ?? "—"}</td><td className="font-medium">{l.action}</td><td className="text-slate-500">{l.entity} {l.entity_id?.slice(0, 8)}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
