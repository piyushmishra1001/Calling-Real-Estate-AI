import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso } from "@/lib/format";
import { buildInsights, type LeadRow } from "./metrics";
import { strongestVisitStatus } from "./score";

export const MAX_INSIGHT_LEADS = 5000;

/** Loads the signed-in user's leads (RLS-scoped) with the activity and visit context scoring needs. */
export async function loadInsights(supabase: SupabaseClient) {
  const since = daysAgoIso(30);
  const [leadsRes, actsRes, visitsRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, project_id, assigned_to, status, budget, purchase_timeline, source, created_at, last_interaction_at, next_follow_up_at")
      .order("created_at", { ascending: false })
      .limit(MAX_INSIGHT_LEADS),
    supabase.from("lead_activities").select("lead_id").gte("created_at", since).limit(50000),
    supabase.from("site_visits").select("lead_id, status").limit(50000),
  ]);
  if (leadsRes.error) return null;
  const activity = new Map<string, number>();
  for (const a of actsRes.data ?? []) activity.set(a.lead_id, (activity.get(a.lead_id) ?? 0) + 1);
  const visitsByLead = new Map<string, string[]>();
  for (const v of visitsRes.data ?? []) visitsByLead.set(v.lead_id, [...(visitsByLead.get(v.lead_id) ?? []), v.status]);
  const rows: LeadRow[] = (leadsRes.data ?? []).map((l) => ({
    ...l,
    budget: l.budget == null ? null : Number(l.budget),
    recent_activity_count: activity.get(l.id) ?? 0,
    visit_status: strongestVisitStatus(visitsByLead.get(l.id) ?? []),
  }));
  return buildInsights(rows);
}
