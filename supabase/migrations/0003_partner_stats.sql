-- Org-wide dashboard numbers for a partner admin. Refuses anyone who is not an admin of that org.
create function partner_stats(p_org uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  ent org_entitlements;
  result jsonb;
begin
  if not is_org_admin(p_org) then raise exception 'not allowed'; end if;
  select * into ent from org_entitlements where org_id = p_org;

  select jsonb_build_object(
    'leads_total', (select count(*) from leads where org_id = p_org),
    'leads_new', (select count(*) from leads where org_id = p_org and status = 'new'),
    'leads_eligible', (select count(*) from leads
        where org_id = p_org and consent_status = 'granted'
          and status not in ('do_not_contact', 'wrong_number', 'not_interested', 'visit_attended')),
    'calls_attempted', (select count(*) from calls where org_id = p_org),
    'calls_connected', (select count(*) from calls where org_id = p_org and connected),
    'leads_interested', (select count(*) from leads where org_id = p_org
        and status in ('interested', 'visit_requested', 'visit_confirmed', 'visit_attended')),
    'callbacks_open', (select count(*) from callback_tasks where org_id = p_org and status = 'open'),
    'visits_requested', (select count(*) from site_visits where org_id = p_org),
    'visits_confirmed', (select count(*) from site_visits where org_id = p_org and status in ('confirmed', 'attended')),
    'visits_attended', (select count(*) from site_visits where org_id = p_org and status = 'attended'),
    'minutes_used', (select coalesce(sum(duration_seconds), 0) / 60.0 from calls
        where org_id = p_org and started_at >= date_trunc('month', now())),
    'minutes_limit', ent.monthly_minute_limit,
    'ai_cost_inr', (select coalesce(sum(stt_cost_inr + tts_cost_inr + llm_cost_inr + orchestration_cost_inr), 0) from calls where org_id = p_org),
    'telephony_cost_inr', (select coalesce(sum(telephony_cost_inr), 0) from calls where org_id = p_org)
  ) into result;
  return result;
end $$;

grant execute on function partner_stats(uuid) to authenticated;
