-- Creates a profile when an invited user first appears in auth.users.
-- Org and role come from the stored INVITATION matched by email, never from user-supplied
-- metadata, so nobody can sign themselves into another organisation or grant themselves a role.
-- Without a valid, unexpired, unaccepted invitation no profile is created and the user has no access.
-- (Public signup is also disabled in Supabase Auth settings; this is defence in depth.)

create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  inv invitations;
begin
  select * into inv
  from invitations
  where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
  order by created_at desc
  limit 1;

  if inv.id is null then
    return new;
  end if;

  if not exists (select 1 from organizations o where o.id = inv.org_id and o.status = 'active') then
    return new;
  end if;

  insert into profiles (id, org_id, role, email, full_name)
  values (new.id, inv.org_id, inv.role, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  update invitations set accepted_at = now() where id = inv.id;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Partner seat limit: an organisation cannot hold more active users than its plan allows.
create function trg_seat_limit() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  seats_allowed integer;
  seats_used integer;
begin
  if new.org_id is null or not new.is_active then return new; end if;
  select seats into seats_allowed from org_entitlements where org_id = new.org_id;
  select count(*) into seats_used from profiles where org_id = new.org_id and is_active and id <> new.id;
  if seats_allowed is not null and seats_used >= seats_allowed then
    raise exception 'seat limit reached for this plan';
  end if;
  return new;
end $$;

create trigger profiles_seat_limit before insert or update of is_active, org_id on profiles
  for each row execute function trg_seat_limit();
