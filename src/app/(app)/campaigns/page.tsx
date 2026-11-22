import Link from "next/link";
import { requireCalling } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, btn, pretty } from "@/components/ui";
import { dt } from "@/lib/format";

const TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = { draft: "slate", running: "green", paused: "amber", stopped: "red", completed: "blue" };

export default async function CampaignsPage() {
  await requireCalling("partner_admin");
  const supabase = await createClient();
  const { data: campaigns } = await supabase.from("campaigns").select("id, name, status, created_at, projects(name)").order("created_at", { ascending: false });
  return (
    <>
      <PageHeader title="Campaigns" actions={<Link href="/campaigns/new" className={btn}>New campaign</Link>} />
      <Card>
        {(campaigns ?? []).length === 0 ? <Empty>No campaigns yet.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2">Name</th><th>Project</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {campaigns!.map((c) => { const p = Array.isArray(c.projects) ? c.projects[0] : c.projects; return (
                <tr key={c.id} className="border-t border-slate-100"><td className="py-2"><Link href={`/campaigns/${c.id}`} className="font-medium text-indigo-700">{c.name}</Link></td><td>{p?.name}</td><td><Badge tone={TONE[c.status]}>{pretty(c.status)}</Badge></td><td className="text-slate-500">{dt(c.created_at)}</td></tr>
              ); })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
