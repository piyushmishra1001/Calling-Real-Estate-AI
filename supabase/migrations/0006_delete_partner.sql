-- Permanently removes one partner organisation and everything that belongs to it.
-- Server-only: the app calls it with the service-role key after a typed confirmation.
-- Runs as one transaction, so it either removes everything or nothing.
-- Returns the ids of the partner's login accounts so the caller can delete them from Supabase Auth,
-- which lets the same email address be invited again.
create function delete_partner_data(p_org uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
begin
  if not exists (select 1 from organizations where id = p_org) then
    raise exception 'partner not found';
  end if;

  select coalesce(array_agg(id), '{}') into v_users from profiles where org_id = p_org;

  -- Children first. Several of these have no cascade on purpose, so deletion has to be explicit.
  delete from calls where org_id = p_org;
  delete from campaign_leads where org_id = p_org;
  delete from site_visits where org_id = p_org;
  delete from callback_tasks where org_id = p_org;
  delete from lead_activities where org_id = p_org;
  delete from leads where org_id = p_org;
  delete from opt_outs where org_id = p_org;
  delete from campaigns where org_id = p_org;
  delete from invitations where org_id = p_org;
  delete from profiles where org_id = p_org;
  delete from organizations where id = p_org; -- org_entitlements and project_assignments cascade

  return jsonb_build_object('user_ids', to_jsonb(v_users));
end $$;

revoke all on function delete_partner_data(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function delete_partner_data(uuid) to service_role;
  end if;
end $$;
