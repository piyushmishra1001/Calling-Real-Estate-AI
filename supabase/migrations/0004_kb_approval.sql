-- Atomic knowledge-base approval. The reviewer is always the caller (never client-supplied),
-- only a super admin can approve, and the previously approved version is superseded in the same step.
create function approve_kb_version(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v project_kb_versions;
begin
  if not is_super_admin() then raise exception 'super admin only'; end if;
  select * into v from project_kb_versions where id = p_id for update;
  if v.id is null then raise exception 'version not found'; end if;
  if v.status <> 'pending_review' then
    raise exception 'only a version that is pending review can be approved (current: %)', v.status;
  end if;
  if v.facts = '{}'::jsonb then raise exception 'cannot approve an empty knowledge base'; end if;

  update project_kb_versions set status = 'superseded'
  where project_id = v.project_id and status = 'approved';

  update project_kb_versions
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;

  insert into audit_logs (actor_id, action, entity, entity_id, payload)
  values (auth.uid(), 'kb.approve', 'project_kb_versions', p_id::text,
          jsonb_build_object('project_id', v.project_id, 'version', v.version));
end $$;

create function reject_kb_version(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'super admin only'; end if;
  update project_kb_versions set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and status = 'pending_review';
  if not found then raise exception 'version is not pending review'; end if;
  insert into audit_logs (actor_id, action, entity, entity_id)
  values (auth.uid(), 'kb.reject', 'project_kb_versions', p_id::text);
end $$;

grant execute on function approve_kb_version(uuid), reject_kb_version(uuid) to authenticated;
