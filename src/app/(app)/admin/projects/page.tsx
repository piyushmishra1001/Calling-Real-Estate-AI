import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/simple-form";
import { Badge, Card, Empty, PageHeader, input, label } from "@/components/ui";
import { createProject } from "../actions";

export default async function AdminProjectsPage() {
  await requireRole("super_admin");
  const supabase = await createClient();
  const [{ data: projects }, { data: assigns }, { data: kbs }] = await Promise.all([
    supabase.from("projects").select("id, name, developer, location").order("created_at", { ascending: false }),
    supabase.from("project_assignments").select("project_id"),
    supabase.from("project_kb_versions").select("project_id, status"),
  ]);
  return (
    <>
      <PageHeader title="Projects" subtitle="Create projects, assign them to partners and approve the facts Riya may use." />
      <Card title="New project">
        <ActionForm action={createProject} submit="Create project" className="grid gap-3 sm:grid-cols-3">
          <div><label className={label}>Name</label><input name="name" required className={input} /></div>
          <div><label className={label}>Developer</label><input name="developer" className={input} /></div>
          <div><label className={label}>Location</label><input name="location" className={input} /></div>
          <div><label className={label}>Category</label><input name="category" placeholder="Residential / Commercial" className={input} /></div>
          <div><label className={label}>Configurations</label><input name="configurations" placeholder="2 BHK, 3 BHK" className={input} /></div>
          <div><label className={label}>Possession</label><input name="possession" className={input} /></div>
          <div className="sm:col-span-3"><label className={label}>Site-visit address</label><input name="site_visit_address" className={input} /></div>
        </ActionForm>
      </Card>
      <div className="mt-6"><Card title="All projects">
        {(projects ?? []).length === 0 ? <Empty>No projects yet.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {projects!.map((p) => {
              const approved = (kbs ?? []).some((k) => k.project_id === p.id && k.status === "approved");
              const pending = (kbs ?? []).filter((k) => k.project_id === p.id && k.status === "pending_review").length;
              return (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div><Link href={`/admin/projects/${p.id}`} className="font-medium text-indigo-700">{p.name}</Link><div className="text-xs text-slate-500">{p.developer} · {p.location} · assigned to {(assigns ?? []).filter((a) => a.project_id === p.id).length} partner(s)</div></div>
                  <div className="flex gap-2">{pending > 0 && <Badge tone="amber">{pending} to review</Badge>}<Badge tone={approved ? "green" : "slate"}>{approved ? "KB approved" : "No approved KB"}</Badge></div>
                </li>
              );
            })}
          </ul>
        )}
      </Card></div>
    </>
  );
}
