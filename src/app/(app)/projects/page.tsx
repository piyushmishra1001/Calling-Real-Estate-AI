import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export default async function ProjectsPage() {
  await requireRole("partner_admin", "partner_employee");
  const supabase = await createClient();
  const [{ data: projects }, { data: kbs }] = await Promise.all([
    supabase.from("projects").select("id, name, developer, location, category, configurations, possession, site_visit_address, status").order("name"),
    supabase.from("project_kb_versions").select("project_id, version, facts, faqs"), // RLS: approved versions only
  ]);
  const kbByProject = new Map((kbs ?? []).map((k) => [k.project_id, k]));
  return (
    <>
      <PageHeader title="Projects" subtitle="Projects assigned to your organisation. Riya may only use approved information." />
      {(projects ?? []).length === 0 ? <Card><Empty>No projects have been assigned to you yet.</Empty></Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects!.map((p) => {
            const kb = kbByProject.get(p.id);
            return (
              <Card key={p.id} title={p.name} action={kb ? <Badge tone="green">Approved info v{kb.version}</Badge> : <Badge tone="amber">Awaiting approval</Badge>}>
                <dl className="space-y-1 text-sm text-slate-700">
                  <div><dt className="inline text-slate-500">Developer: </dt><dd className="inline">{p.developer ?? "—"}</dd></div>
                  <div><dt className="inline text-slate-500">Location: </dt><dd className="inline">{p.location ?? "—"}</dd></div>
                  <div><dt className="inline text-slate-500">Configurations: </dt><dd className="inline">{p.configurations?.join(", ") || "—"}</dd></div>
                  <div><dt className="inline text-slate-500">Possession: </dt><dd className="inline">{p.possession ?? "—"}</dd></div>
                  <div><dt className="inline text-slate-500">Site address: </dt><dd className="inline">{p.site_visit_address ?? "—"}</dd></div>
                </dl>
                {!kb && <p className="mt-3 text-xs text-amber-700">Campaigns for this project are blocked until LeadPilot approves its knowledge base.</p>}
                {kb && (
                  <details className="mt-3"><summary className="cursor-pointer text-xs text-indigo-600">Approved facts Riya can use</summary>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
                      {Object.entries(kb.facts as Record<string, string>).map(([k, v]) => <li key={k}><strong>{k}:</strong> {String(v)}</li>)}
                    </ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
