import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/simple-form";
import { LeadFields } from "@/components/lead-fields";
import { Card, Notice, PageHeader, btnGhost, input, label } from "@/components/ui";
import { createLead } from "../actions";

export default async function NewLeadPage() {
  await requireRole("partner_admin");
  const supabase = await createClient();
  const [{ data: projects }, { data: employees }] = await Promise.all([
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, email").eq("role", "partner_employee").eq("is_active", true),
  ]);
  return (
    <>
      <PageHeader title="Add lead" subtitle="Enter one enquiry by hand. For many at once, use Import CSV." actions={<Link href="/leads" className={btnGhost}>Back</Link>} />
      {(projects ?? []).length === 0 ? (
        <Notice>No projects are assigned to your organisation yet. Ask LeadPilot to assign one.</Notice>
      ) : (
        <Card>
          <ActionForm action={createLead} submit="Add lead" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label} htmlFor="project_id">Project</label>
                <select id="project_id" name="project_id" required className={input}>
                  {projects!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div><label className={label} htmlFor="assigned_to">Assign to</label>
                <select id="assigned_to" name="assigned_to" className={input}>
                  <option value="">Unassigned</option>
                  {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name ?? e.email}</option>)}
                </select></div>
            </div>
            <LeadFields withPhone />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
