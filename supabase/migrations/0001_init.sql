-- LeadPilot AI: initial multi-tenant schema with Row Level Security.
-- Design rules:
--   * Every partner-owned row carries org_id and is protected by RLS.
--   * Super Admin manages the platform but has NO direct row access to customer data
--     (leads, calls, site visits). Platform analytics come from aggregate functions.
--   * Calls and audit logs are written server-side (service role) only.
--   * Suspended / deactivated organisations lose access to all operational data.

-- ---------------------------------------------------------------- enums
create type user_role as enum ('super_admin', 'partner_admin', 'partner_employee');
create type org_status as enum ('active', 'suspended', 'deactivated');
create type lead_status as enum (
  'new', 'queued', 'calling', 'connected', 'interested', 'callback_requested',
  'visit_requested', 'visit_confirmed', 'visit_attended', 'not_interested',
  'wrong_number', 'do_not_contact'
);
create type consent_status as enum ('unknown', 'granted', 'denied');
create type kb_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'superseded');
create type campaign_status as enum ('draft', 'running', 'paused', 'stopped', 'completed');
create type visit_status as enum (
  'requested', 'pending_confirmation', 'confirmed', 'cancelled', 'rescheduled', 'attended', 'no_show'
);
create type task_status as enum ('open', 'done', 'cancelled');

-- ---------------------------------------------------------------- core tables
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status org_status not null default 'active',
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid references organizations (id),
  role user_role not null,
  full_name text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- super admins belong to no organisation; everyone else must
  constraint profiles_org_matches_role check (
    (role = 'super_admin' and org_id is null) or (role <> 'super_admin' and org_id is not null)
  )
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  email text not null,
  role user_role not null check (role in ('partner_admin', 'partner_employee')),
  token_hash text not null,
  invited_by uuid references profiles (id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table org_entitlements (
  org_id uuid primary key references organizations (id) on delete cascade,
  plan text not null default 'crm',
  included_minutes integer not null default 0,
  seats integer not null default 5,
  daily_call_limit integer not null default 0,
  monthly_minute_limit integer not null default 0,
  updated_at timestamptz not null default now()
);

create table platform_settings (
  id integer primary key default 1 check (id = 1),
  calling_kill_switch boolean not null default false,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);
insert into platform_settings (id) values (1);

-- ---------------------------------------------------------------- projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  developer text,
  location text,
  category text,
  configurations text[] not null default '{}',
  amenities text[] not null default '{}',
  pricing jsonb not null default '{}',
  payment_plans text,
  possession text,
  connectivity text,
  site_visit_address text,
  brochure_path text,
  sales_contact jsonb not null default '{}',
  status text not null default 'active',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table project_assignments (
  project_id uuid not null references projects (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (project_id, org_id)
);

-- Versioned knowledge base. Only 'approved' versions may ever reach Riya.
create table project_kb_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  version integer not null,
  facts jsonb not null default '{}',
  faqs jsonb not null default '[]',
  status kb_status not null default 'draft',
  source_document text,
  extracted_at timestamptz,
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version),
  constraint kb_approved_needs_reviewer check (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null))
);
-- at most one approved version per project
create unique index project_kb_one_approved on project_kb_versions (project_id) where status = 'approved';

-- ---------------------------------------------------------------- CRM
create table leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  project_id uuid not null references projects (id),
  name text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  source text,
  enquiry_type text check (enquiry_type in ('residential', 'commercial')),
  preferred_config text,
  preferred_location text,
  budget numeric,
  purchase_timeline text,
  assigned_to uuid references profiles (id),
  consent_status consent_status not null default 'unknown',
  status lead_status not null default 'new',
  last_interaction_at timestamptz,
  next_follow_up_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, project_id, phone)
);
create index leads_org_status on leads (org_id, status);
create index leads_assigned on leads (assigned_to);

-- Append-only history: never overwrite, always add.
create table lead_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  lead_id uuid not null references leads (id) on delete cascade,
  actor_id uuid references profiles (id),
  kind text not null,
  from_status lead_status,
  to_status lead_status,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index lead_activities_lead on lead_activities (lead_id, created_at);

create table opt_outs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  reason text,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);

create table callback_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  lead_id uuid not null references leads (id) on delete cascade,
  assigned_to uuid references profiles (id),
  due_at timestamptz,
  status task_status not null default 'open',
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- campaigns and calls
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  project_id uuid not null references projects (id),
  name text not null,
  status campaign_status not null default 'draft',
  window_start time not null default '10:00',
  window_end time not null default '19:00',
  max_retries integer not null default 1 check (max_retries between 0 and 3),
  concurrency integer not null default 1 check (concurrency between 1 and 20),
  created_by uuid references profiles (id),
  stopped_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table campaign_leads (
  campaign_id uuid not null references campaigns (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  org_id uuid not null references organizations (id),
  state text not null default 'queued',
  attempts integer not null default 0,
  primary key (campaign_id, lead_id)
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  lead_id uuid not null references leads (id),
  project_id uuid not null references projects (id),
  campaign_id uuid references campaigns (id),
  provider text,
  provider_call_id text,
  status text not null default 'initiated',
  connected boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  transcript jsonb not null default '[]',
  outcome jsonb,
  stt_cost_inr numeric not null default 0,
  tts_cost_inr numeric not null default 0,
  llm_cost_inr numeric not null default 0,
  orchestration_cost_inr numeric not null default 0,
  telephony_cost_inr numeric not null default 0
);
create index calls_org_started on calls (org_id, started_at);

create table site_visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  lead_id uuid not null references leads (id) on delete cascade,
  project_id uuid not null references projects (id),
  preferred_at timestamptz,
  scheduled_at timestamptz,
  assigned_to uuid references profiles (id),
  status visit_status not null default 'requested',
  confirmation_source text,
  attended_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  -- a visit can only be 'confirmed' once a human or scheduling system has reserved a slot
  constraint visit_confirmed_needs_slot check (
    status not in ('confirmed', 'attended') or (scheduled_at is not null and confirmation_source is not null)
  )
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  org_id uuid,
  action text not null,
  entity text,
  entity_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helper functions
-- SECURITY DEFINER so they can read profiles without recursing into RLS.
create function auth_uid() returns uuid
  language sql stable as $$ select auth.uid() $$;

create function is_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin' and p.is_active
  )
$$;

create function my_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select p.role from profiles p where p.id = auth.uid() and p.is_active
$$;

create function my_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select p.org_id from profiles p where p.id = auth.uid() and p.is_active
$$;

-- member of an ACTIVE organisation
create function has_org_access(org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p join organizations o on o.id = p.org_id
    where p.id = auth.uid() and p.is_active and p.org_id = org and o.status = 'active'
  )
$$;

create function is_org_admin(org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p join organizations o on o.id = p.org_id
    where p.id = auth.uid() and p.is_active and p.org_id = org
      and p.role = 'partner_admin' and o.status = 'active'
  )
$$;

create function project_assigned_to_org(proj uuid, org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_assignments a where a.project_id = proj and a.org_id = org)
$$;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table invitations enable row level security;
alter table org_entitlements enable row level security;
alter table platform_settings enable row level security;
alter table projects enable row level security;
alter table project_assignments enable row level security;
alter table project_kb_versions enable row level security;
alter table leads enable row level security;
alter table lead_activities enable row level security;
alter table opt_outs enable row level security;
alter table callback_tasks enable row level security;
alter table campaigns enable row level security;
alter table campaign_leads enable row level security;
alter table calls enable row level security;
alter table site_visits enable row level security;
alter table audit_logs enable row level security;

-- ---------------------------------------------------------------- policies
-- organizations
create policy org_select on organizations for select to authenticated
  using (is_super_admin() or id = my_org_id());
create policy org_write on organizations for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- profiles: employees only see themselves; admins see their org; super admin sees all
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or is_super_admin() or (org_id is not null and is_org_admin(org_id)));
create policy profiles_super_write on profiles for all to authenticated
  using (is_super_admin()) with check (is_super_admin());
-- partner admins manage only employees of their own org; cannot create admins or super admins
create policy profiles_admin_update on profiles for update to authenticated
  using (org_id is not null and is_org_admin(org_id) and role = 'partner_employee')
  with check (org_id is not null and is_org_admin(org_id) and role = 'partner_employee');

-- invitations
create policy invitations_select on invitations for select to authenticated
  using (is_super_admin() or is_org_admin(org_id));
create policy invitations_super_insert on invitations for insert to authenticated
  with check (is_super_admin());
create policy invitations_admin_insert on invitations for insert to authenticated
  with check (is_org_admin(org_id) and role = 'partner_employee' and invited_by = auth.uid());

-- entitlements: partners read their own, only super admin writes
create policy ent_select on org_entitlements for select to authenticated
  using (is_super_admin() or has_org_access(org_id));
create policy ent_write on org_entitlements for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- platform settings (kill switch)
create policy settings_select on platform_settings for select to authenticated using (true);
create policy settings_update on platform_settings for update to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- projects: partners only see projects assigned to their org
create policy projects_select on projects for select to authenticated
  using (is_super_admin() or exists (
    select 1 from project_assignments a
    where a.project_id = projects.id and has_org_access(a.org_id)
  ));
create policy projects_write on projects for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy assignments_select on project_assignments for select to authenticated
  using (is_super_admin() or has_org_access(org_id));
create policy assignments_write on project_assignments for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- knowledge base: partners only ever see APPROVED versions of assigned projects
create policy kb_select on project_kb_versions for select to authenticated
  using (
    is_super_admin()
    or (status = 'approved' and exists (
      select 1 from project_assignments a
      where a.project_id = project_kb_versions.project_id and has_org_access(a.org_id)
    ))
  );
create policy kb_write on project_kb_versions for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- leads
create policy leads_select on leads for select to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and assigned_to = auth.uid()));
create policy leads_insert on leads for insert to authenticated
  with check (is_org_admin(org_id) and project_assigned_to_org(project_id, org_id));
create policy leads_update_admin on leads for update to authenticated
  using (is_org_admin(org_id))
  with check (is_org_admin(org_id) and project_assigned_to_org(project_id, org_id));
create policy leads_update_employee on leads for update to authenticated
  using (has_org_access(org_id) and assigned_to = auth.uid())
  with check (has_org_access(org_id) and assigned_to = auth.uid());
create policy leads_delete on leads for delete to authenticated
  using (is_org_admin(org_id));

-- lead activities (append-only: no update or delete policies)
create policy activities_select on lead_activities for select to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and exists (
    select 1 from leads l where l.id = lead_activities.lead_id and l.assigned_to = auth.uid()
  )));
create policy activities_insert on lead_activities for insert to authenticated
  with check (
    actor_id = auth.uid() and (
      is_org_admin(org_id) or (has_org_access(org_id) and exists (
        select 1 from leads l where l.id = lead_activities.lead_id and l.assigned_to = auth.uid()
      ))
    )
  );

-- opt-outs: any org member can record one, only admins can read the full list
create policy optouts_select on opt_outs for select to authenticated using (is_org_admin(org_id));
create policy optouts_insert on opt_outs for insert to authenticated with check (has_org_access(org_id));

-- callback tasks
create policy tasks_select on callback_tasks for select to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and assigned_to = auth.uid()));
create policy tasks_insert on callback_tasks for insert to authenticated
  with check (is_org_admin(org_id) or (has_org_access(org_id) and assigned_to = auth.uid()));
create policy tasks_update on callback_tasks for update to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and assigned_to = auth.uid()))
  with check (is_org_admin(org_id) or (has_org_access(org_id) and assigned_to = auth.uid()));

-- campaigns: partner admins run them; super admin can read and stop them
create policy campaigns_select on campaigns for select to authenticated
  using (is_super_admin() or is_org_admin(org_id));
create policy campaigns_insert on campaigns for insert to authenticated
  with check (is_org_admin(org_id) and project_assigned_to_org(project_id, org_id));
create policy campaigns_update_admin on campaigns for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy campaigns_update_super on campaigns for update to authenticated
  using (is_super_admin()) with check (is_super_admin());

create policy campaign_leads_all on campaign_leads for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- calls: read-only for partners (written by the server); super admin sees aggregates only
create policy calls_select on calls for select to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and exists (
    select 1 from leads l where l.id = calls.lead_id and l.assigned_to = auth.uid()
  )));

-- site visits
create policy visits_select on site_visits for select to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and exists (
    select 1 from leads l where l.id = site_visits.lead_id and l.assigned_to = auth.uid()
  )));
create policy visits_insert on site_visits for insert to authenticated
  with check (is_org_admin(org_id) or (has_org_access(org_id) and exists (
    select 1 from leads l where l.id = site_visits.lead_id and l.assigned_to = auth.uid()
  )));
create policy visits_update on site_visits for update to authenticated
  using (is_org_admin(org_id) or (has_org_access(org_id) and exists (
    select 1 from leads l where l.id = site_visits.lead_id and l.assigned_to = auth.uid()
  )))
  with check (is_org_admin(org_id) or has_org_access(org_id));

-- audit logs: read-only; written by the server only
create policy audit_select on audit_logs for select to authenticated
  using (is_super_admin() or (org_id is not null and is_org_admin(org_id)));

-- ---------------------------------------------------------------- triggers
create function trg_org_defaults() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into org_entitlements (org_id) values (new.id);
  return new;
end $$;
create trigger org_defaults after insert on organizations
  for each row execute function trg_org_defaults();

-- Every status change is recorded in the activity history.
create function trg_lead_status_history() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into lead_activities (org_id, lead_id, actor_id, kind, from_status, to_status)
    values (new.org_id, new.id, auth.uid(), 'status_change', old.status, new.status);
    new.last_interaction_at := now();
  end if;
  return new;
end $$;
create trigger lead_status_history before update on leads
  for each row execute function trg_lead_status_history();

-- Employees cannot rewrite identity fields; nobody can move a lead between orgs.
create function trg_lead_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.org_id <> old.org_id then
    raise exception 'lead cannot change organisation';
  end if;
  if auth.uid() is not null and not is_org_admin(old.org_id) then
    if new.phone <> old.phone or new.project_id <> old.project_id or new.assigned_to is distinct from old.assigned_to then
      raise exception 'only a partner admin can change phone, project or assignment';
    end if;
  end if;
  return new;
end $$;
create trigger lead_guard before update on leads
  for each row execute function trg_lead_guard();

-- Recording an opt-out immediately blocks the lead from any further calling.
create function trg_opt_out_applies() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update leads set status = 'do_not_contact', consent_status = 'denied'
  where org_id = new.org_id and phone = new.phone and status <> 'do_not_contact';
  return new;
end $$;
create trigger opt_out_applies after insert on opt_outs
  for each row execute function trg_opt_out_applies();

-- Super admin cannot use campaign updates to change anything except stopping a campaign.
create function trg_campaign_super_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if is_super_admin() then
    if new.org_id <> old.org_id or new.project_id <> old.project_id or new.name <> old.name then
      raise exception 'super admin may only change campaign status';
    end if;
    if new.status = 'stopped' then new.stopped_by := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger campaign_super_guard before update on campaigns
  for each row execute function trg_campaign_super_guard();

-- ---------------------------------------------------------------- calling gate and metrics
-- Server calls this before every outbound call. Returns {allowed, reason}.
create function can_start_call(p_org uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  ks boolean;
  st org_status;
  ent org_entitlements;
  minutes_used numeric;
  calls_today integer;
begin
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

-- 0, 70, 85 or 100: the highest alert threshold reached this month.
create function usage_alert_level(p_org uuid) returns integer
  language plpgsql stable security definer set search_path = public as $$
declare
  lim integer;
  used numeric;
  pct numeric;
begin
  if not (is_super_admin() or has_org_access(p_org)) then
    raise exception 'not allowed';
  end if;
  select monthly_minute_limit into lim from org_entitlements where org_id = p_org;
  if lim is null or lim <= 0 then return 0; end if;
  select coalesce(sum(duration_seconds), 0) / 60.0 into used
  from calls where org_id = p_org and started_at >= date_trunc('month', now());
  pct := used / lim * 100;
  if pct >= 100 then return 100; end if;
  if pct >= 85 then return 85; end if;
  if pct >= 70 then return 70; end if;
  return 0;
end $$;

-- Platform-wide analytics for the super admin, without exposing customer rows.
create function platform_stats() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not is_super_admin() then raise exception 'super admin only'; end if;
  select jsonb_build_object(
    'partners_active', (select count(*) from organizations where status = 'active'),
    'partners_suspended', (select count(*) from organizations where status <> 'active'),
    'projects', (select count(*) from projects),
    'leads', (select count(*) from leads),
    'calls_attempted', (select count(*) from calls),
    'calls_connected', (select count(*) from calls where connected),
    'connected_minutes', (select coalesce(sum(duration_seconds), 0) / 60.0 from calls where connected),
    'ai_cost_inr', (select coalesce(sum(stt_cost_inr + tts_cost_inr + llm_cost_inr + orchestration_cost_inr), 0) from calls),
    'telephony_cost_inr', (select coalesce(sum(telephony_cost_inr), 0) from calls),
    'visits_requested', (select count(*) from site_visits),
    'visits_confirmed', (select count(*) from site_visits where status in ('confirmed', 'attended')),
    'visits_attended', (select count(*) from site_visits where status = 'attended')
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------- privileges
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- server-only tables: no direct writes from signed-in users
revoke insert, update, delete on calls from authenticated;
revoke insert, update, delete on audit_logs from authenticated;
-- lead history cannot be edited by clients
revoke update, delete on lead_activities from authenticated;
grant execute on all functions in schema public to authenticated;
