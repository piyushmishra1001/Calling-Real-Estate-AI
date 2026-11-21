-- can_start_call is callable by the server (service role, no auth.uid()), by the super admin,
-- and by members of that organisation only. Other partners cannot probe an organisation's limits.
create or replace function can_start_call(p_org uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  ks boolean;
  st org_status;
  ent org_entitlements;
  minutes_used numeric;
  calls_today integer;
begin
  if auth.uid() is not null and not (is_super_admin() or has_org_access(p_org) or is_org_admin(p_org)) then
    raise exception 'not allowed';
  end if;

  select calling_kill_switch into ks from platform_settings where id = 1;
  if ks then return jsonb_build_object('allowed', false, 'reason', 'kill_switch'); end if;

  select status into st from organizations where id = p_org;
  if st is null or st <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'organisation_not_active');
  end if;

  select * into ent from org_entitlements where org_id = p_org;
  if ent.monthly_minute_limit <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'no_ai_entitlement');
  end if;

  select coalesce(sum(duration_seconds), 0) / 60.0 into minutes_used
  from calls where org_id = p_org and started_at >= date_trunc('month', now());
  if minutes_used >= ent.monthly_minute_limit then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_limit_reached');
  end if;

  select count(*) into calls_today from calls where org_id = p_org and started_at >= date_trunc('day', now());
  if ent.daily_call_limit > 0 and calls_today >= ent.daily_call_limit then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit_reached');
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok');
end $$;
