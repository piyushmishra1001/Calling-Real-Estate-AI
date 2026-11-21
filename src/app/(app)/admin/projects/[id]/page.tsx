import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/simple-form";
import { Badge, Card, Empty, Notice, PageHeader, btn, btnDanger, btnGhost, input, label, pretty } from "@/components/ui";
import { dt } from "@/lib/format";
import { createKbDraft, decideKb, setAssignment, submitKbForReview } from "../../actions";

const FIELDS: [string, string][] = [
  ["location", "Location"], ["configurations", "Configurations and sizes"], ["pricing", "Pricing"], ["paymentPlans", "Payment plans"],
  ["possession", "Possession"], ["amenities", "Amenities"], ["connectivity", "Connectivity"], ["siteVisitAddress", "Site-visit address"],
];
const TONE: Record<string, "green" | "amber" | "red" | "slate"> = { approved: "green", pending_review: "amber", draft: "slate", rejected: "red", superseded: "slate" };

export default async function AdminProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("super_admin");
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const [{ data: orgs }, { data: assigned }, { data: versions }] = await Promise.all([
    supabase.from("organizations").select("id, name, status").order("name"),
    supabase.from("project_assignments").select("org_id").eq("project_id", id),
    supabase.from("project_kb_versions").select("*").eq("project_id", id).order("version", { ascending: false }),
  ]);
  const assignedIds = new Set((assigned ?? []).map((a) => a.org_id));
  const latest = (versions ?? []).find((v) => v.status === "approved") ?? (versions ?? [])[0];
  const latestFacts = (latest?.facts ?? {}) as Record<string, string>;

  return (
    <>
      <PageHeader title={project.name} subtitle={[project.developer, project.location].filter(Boolean).join(" · ")} actions={<Link href="/admin/projects" className={btnGhost}>Back</Link>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Knowledge base versions">
            <div className="mb-3"><Notice tone="blue">Only an <strong>approved</strong> version is ever available to Riya. Brochure text is not auto-extracted yet: type in facts you have verified against the source document.</Notice></div>
            {(versions ?? []).length === 0 ? <Empty>No versions yet.</Empty> : (
              <ul className="space-y-3">
                {versions!.map((v) => (
                  <li key={v.id} className="rounded border border-slate-200 p-3 text-sm">
                    <div className="flex items-center justify-between"><span className="font-medium">Version {v.version} <span className="text-xs font-normal text-slate-500">· {v.source_document}</span></span><Badge tone={TONE[v.status]}>{pretty(v.status)}</Badge></div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">{Object.entries(v.facts as Record<string, string>).map(([k, val]) => <li key={k}><strong>{k}:</strong> {val}</li>)}</ul>
                    {Array.isArray(v.faqs) && v.faqs.length > 0 && <p className="mt-1 text-xs text-slate-500">{v.faqs.length} approved FAQ(s)</p>}
                    {v.reviewed_at && <p className="mt-1 text-xs text-slate-500">Reviewed {dt(v.reviewed_at)}</p>}
                    <div className="mt-2 flex gap-2">
                      {v.status === "draft" && <form action={submitKbForReview}><input type="hidden" name="id" value={v.id} /><button className={btnGhost}>Submit for review</button></form>}
                      {v.status === "pending_review" && (
                        <form action={decideKb} className="flex gap-2"><input type="hidden" name="id" value={v.id} />
                          <button name="decision" value="approve" className={btn}>Approve</button><button name="decision" value="reject" className={btnDanger}>Reject</button></form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={latest ? "New version (pre-filled from the latest)" : "First version"}>
            <ActionForm action={createKbDraft} submit="Save draft">
              <input type="hidden" name="project_id" value={id} />
              {FIELDS.map(([k, l]) => <div key={k}><label className={label}>{l}</label><input name={k} defaultValue={latestFacts[k] ?? ""} className={input} /></div>)}
              <div><label className={label}>FAQs, one per line: question | answer</label><textarea name="faqs" rows={4} className={input} placeholder="Is there a swimming pool? | Yes, a podium-level pool." /></div>
              <div><label className={label}>Source document</label><input name="source" placeholder="e.g. Brochure v3, 12 Nov 2026" className={input} /></div>
            </ActionForm>
          </Card>
        </div>
        <Card title="Assigned partners">
          <p className="mb-2 text-xs text-slate-500">Each partner sees only their own leads, even on a shared project.</p>
          <ul className="space-y-2 text-sm">
            {(orgs ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between"><span>{o.name}</span>
                <form action={setAssignment}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="org_id" value={o.id} />
                  <button name="assign" value={String(!assignedIds.has(o.id))} className={assignedIds.has(o.id) ? btnDanger : btnGhost}>{assignedIds.has(o.id) ? "Unassign" : "Assign"}</button></form></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
