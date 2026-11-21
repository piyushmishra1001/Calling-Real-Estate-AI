"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { evaluateCampaignStart, validateWindow } from "@/lib/campaign-safety";

export type CampaignState = { error?: string; message?: string; blockers?: string[] } | undefined;

export async function createCampaign(_: CampaignState, form: FormData): Promise<CampaignState> {
  const s = await requireRole("partner_admin");
  const name = String(form.get("name") ?? "").trim();
  const projectId = String(form.get("project_id") ?? "");
  const start = String(form.get("window_start") ?? "10:00");
  const end = String(form.get("window_end") ?? "19:00");
  const retries = Math.min(3, Math.max(0, Number(form.get("max_retries") ?? 1) || 0));
  const concurrency = Math.min(20, Math.max(1, Number(form.get("concurrency") ?? 1) || 1));
  if (!name) return { error: "Give the campaign a name." };
  if (!projectId) return { error: "Choose a project." };
  const windowError = validateWindow(start, end);
  if (windowError) return { error: windowError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ org_id: s.orgId!, project_id: projectId, name, window_start: start, window_end: end, max_retries: retries, concurrency, created_by: s.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the campaign. Is the project assigned to your organisation?" };
  await audit(s, "campaign.create", "campaign", data.id, { name, projectId });
  redirect(`/campaigns/${data.id}`);
}

/** Runs every pre-start safety check on the server. Nothing here places a call. */
export async function startCampaign(form: FormData) {
  const s = await requireRole("partner_admin");
  const id = String(form.get("id"));
  const supabase = await createClient();
  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!c || !["draft", "paused"].includes(c.status)) return;

  const [{ data: gate }, { data: kb }, { data: leads }, { data: opt }] = await Promise.all([
    supabase.rpc("can_start_call", { p_org: s.orgId! }),
    supabase.from("project_kb_versions").select("id").eq("project_id", c.project_id).eq("status", "approved").maybeSingle(),
    supabase.from("leads").select("id, phone, status, consent_status").eq("project_id", c.project_id).limit(50_000),
    supabase.from("opt_outs").select("phone").limit(50_000),
  ]);

  const decision = evaluateCampaignStart({
    gate: gate ?? { allowed: false, reason: "unknown" },
    hasApprovedKnowledgeBase: !!kb,
    window: { start: String(c.window_start).slice(0, 5), end: String(c.window_end).slice(0, 5) },
    now: new Date(),
    leads: (leads ?? []) as never,
    optedOutPhones: new Set((opt ?? []).map((o) => o.phone)),
    concurrency: c.concurrency,
  });

  // Being outside the calling window is not a reason to refuse to queue: calls simply begin when it opens.
  const hardBlockers = decision.blockers.filter((b) => !b.startsWith("Outside the campaign's calling window"));
  if (hardBlockers.length > 0) {
    await audit(s, "campaign.start_blocked", "campaign", id, { blockers: hardBlockers });
    redirect(`/campaigns/${id}?blocked=${encodeURIComponent(hardBlockers.join(" | "))}`);
  }

  if (decision.eligibleLeadIds.length > 0) {
    const rows = decision.eligibleLeadIds.map((lead_id) => ({ campaign_id: id, lead_id, org_id: s.orgId!, state: "queued" }));
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("campaign_leads").upsert(rows.slice(i, i + 500), { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
    }
    await supabase.from("leads").update({ status: "queued" }).in("id", decision.eligibleLeadIds.slice(0, 1000)).eq("status", "new");
  }
  await supabase.from("campaigns").update({ status: "running" }).eq("id", id);
  await audit(s, "campaign.start", "campaign", id, { queued: decision.eligibleLeadIds.length, excluded: decision.excluded });
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
}

export async function setCampaignStatus(form: FormData) {
  const s = await requireRole("partner_admin");
  const id = String(form.get("id"));
  const to = String(form.get("to"));
  if (!["paused", "running", "stopped"].includes(to)) return;
  const supabase = await createClient();
  const { data: c } = await supabase.from("campaigns").select("status").eq("id", id).maybeSingle();
  if (!c) return;
  // Resuming re-runs every safety check via startCampaign; here we only allow pause and stop directly.
  if (to === "running") return startCampaign(form);
  if (c.status === "stopped" || c.status === "completed") return;
  await supabase.from("campaigns").update({ status: to, ...(to === "stopped" ? { stopped_by: s.userId } : {}) }).eq("id", id);
  if (to === "stopped") {
    const { data: queued } = await supabase.from("campaign_leads").select("lead_id").eq("campaign_id", id).eq("state", "queued");
    const ids = (queued ?? []).map((q) => q.lead_id);
    if (ids.length) await supabase.from("leads").update({ status: "new" }).in("id", ids).eq("status", "queued");
    await supabase.from("campaign_leads").update({ state: "cancelled" }).eq("campaign_id", id).eq("state", "queued");
  }
  await audit(s, `campaign.${to}`, "campaign", id);
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
}
