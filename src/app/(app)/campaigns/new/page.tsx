import { requireCalling } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/simple-form";
import { Card, Notice, PageHeader, input, label } from "@/components/ui";
import { createCampaign } from "../actions";

export default async function NewCampaignPage() {
  await requireCalling("partner_admin");
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, name").order("name");
  return (
    <>
      <PageHeader title="New campaign" subtitle="Choose a project and calling rules. Safety checks run again when you start it." />
      {(projects ?? []).length === 0 ? <Notice>No projects are assigned to you yet.</Notice> : (
        <div className="max-w-xl"><Card>
          <ActionForm action={createCampaign} submit="Create campaign">
            <div><label className={label}>Name</label><input name="name" required className={input} placeholder="e.g. December follow-up" /></div>
            <div><label className={label}>Project</label>
              <select name="project_id" required className={input}><option value="">Select…</option>{projects!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Calling window start</label><input type="time" name="window_start" defaultValue="10:00" className={input} /></div>
              <div><label className={label}>Calling window end</label><input type="time" name="window_end" defaultValue="19:00" className={input} /></div>
            </div>
            <p className="text-xs text-slate-500">Windows must fall within 09:00–21:00 IST.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Retries per lead (0–3)</label><input type="number" name="max_retries" min={0} max={3} defaultValue={1} className={input} /></div>
              <div><label className={label}>Concurrent calls (1–20)</label><input type="number" name="concurrency" min={1} max={20} defaultValue={1} className={input} /></div>
            </div>
          </ActionForm>
        </Card></div>
      )}
    </>
  );
}
