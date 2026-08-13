-- Safe administrative withdrawal and a private case-message inbox.
-- No row is physically deleted: humanitarian records and their audit trail are preserved.

create or replace function public.get_admin_people_cases(
  p_query text default '',
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_query text := nullif(btrim(p_query), '');
  v_result jsonb;
  v_count integer;
begin
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;
  if p_limit < 1 or p_limit > 250 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid people management pagination';
  end if;
  if v_query is not null and char_length(v_query) > 140 then
    raise exception using errcode = '22023', message = 'Search query is too long';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'caseId', managed.id,
    'slug', managed.slug,
    'fullName', managed.full_name,
    'approximateAge', managed.approximate_age,
    'conditionStatus', managed.condition_status,
    'verificationLevel', managed.verification_level,
    'publicationStatus', managed.publication_status,
    'reportedUnit', managed.reported_unit,
    'publicLocation', managed.last_seen_location_public,
    'publishedAt', managed.published_at,
    'withdrawnAt', managed.deleted_at,
    'updatedAt', managed.updated_at
  ) order by
    case managed.publication_status when 'published' then 0 else 1 end,
    managed.updated_at desc), '[]'::jsonb), count(*)::integer
  into v_result, v_count
  from (
    select c.id, c.slug, p.full_name, p.approximate_age,
      c.condition_status, c.verification_level, c.publication_status,
      c.reported_unit, c.last_seen_location_public, c.published_at,
      c.deleted_at, c.updated_at
    from public.cases c
    join public.people p on p.id = c.person_id
    where p.is_test_data = false
      and c.publication_status in ('published', 'hidden', 'archived')
      and (
        v_query is null
        or p.normalized_name like '%' || public.normalize_person_name(v_query) || '%'
        or coalesce(c.reported_unit, '') ilike '%' || v_query || '%'
        or coalesce(c.last_seen_location_public, '') ilike '%' || v_query || '%'
      )
    order by case c.publication_status when 'published' then 0 else 1 end, c.updated_at desc
    limit p_limit offset p_offset
  ) managed;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (
    v_actor,
    'admin_people_cases_accessed',
    'case_queue',
    jsonb_build_object('resultCount', coalesce(v_count, 0), 'filtered', v_query is not null)
  );

  return v_result;
end;
$$;

revoke all on function public.get_admin_people_cases(text,integer,integer) from public, anon;
grant execute on function public.get_admin_people_cases(text,integer,integer) to authenticated;

create or replace function public.withdraw_person_case(
  p_case_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.cases%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'A withdrawal reason between 3 and 1000 characters is required';
  end if;

  select * into v_case
  from public.cases
  where id = p_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Case not found';
  end if;
  if v_case.publication_status <> 'published' or v_case.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'Only a currently published case can be withdrawn';
  end if;

  update public.cases
  set publication_status = 'archived',
      deleted_at = clock_timestamp(),
      reviewed_by = v_actor,
      updated_at = clock_timestamp()
  where id = p_case_id;

  insert into public.moderation_actions (case_id, actor_id, action, reason, metadata)
  values (
    p_case_id,
    v_actor,
    'archive',
    v_reason,
    jsonb_build_object(
      'operation', 'withdraw_published_case',
      'previousPublicationStatus', v_case.publication_status,
      'newPublicationStatus', 'archived'
    )
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'published_person_case_withdrawn',
    'case',
    p_case_id,
    jsonb_build_object(
      'reason', v_reason,
      'previousPublicationStatus', v_case.publication_status,
      'newPublicationStatus', 'archived'
    )
  );

  return jsonb_build_object(
    'caseId', p_case_id,
    'slug', v_case.slug,
    'publicationStatus', 'archived',
    'withdrawn', true
  );
end;
$$;

revoke all on function public.withdraw_person_case(uuid,text) from public, anon;
grant execute on function public.withdraw_person_case(uuid,text) to authenticated;

create or replace function public.get_admin_case_message_threads(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'Invalid message thread limit';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'caseId', thread.id,
    'caseSlug', thread.slug,
    'personName', thread.full_name,
    'conditionStatus', thread.condition_status,
    'publicationStatus', thread.publication_status,
    'latestMessageAt', thread.latest_message_at,
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reportId', r.id,
        'reportType', r.report_type,
        'reportContext', r.report_context,
        'moderationStatus', r.moderation_status,
        'urgencyLevel', r.urgency_level,
        'submittedAt', r.submitted_at,
        'eventAt', r.event_at,
        'descriptionPrivate', r.description,
        'locationPrivate', r.location_private,
        'contactId', rc.id,
        'reporterName', rc.reporter_name,
        'phone', rc.phone,
        'email', rc.email,
        'relationship', rc.relationship_to_person,
        'preferredContactMethod', rc.preferred_contact_method,
        'hasEvidence', exists(select 1 from public.media_assets m where m.report_id = r.id)
      ) order by r.submitted_at asc, r.id asc), '[]'::jsonb)
      from public.case_reports r
      left join public.reporter_contacts rc on rc.report_id = r.id
      where r.case_id = thread.id
    ),
    'followups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'followupId', f.id,
        'reportId', f.report_id,
        'contactId', f.contact_id,
        'targetType', f.target_type,
        'contactMethod', f.contact_method,
        'contactStatus', f.contact_status,
        'summaryPrivate', f.summary_private,
        'nextFollowupAt', f.next_followup_at,
        'createdAt', f.created_at
      ) order by f.created_at asc, f.id asc), '[]'::jsonb)
      from public.contact_followups f
      where f.case_id = thread.id
    )
  ) order by thread.latest_message_at desc), '[]'::jsonb), count(*)::integer
  into v_result, v_count
  from (
    select c.id, c.slug, p.full_name, c.condition_status, c.publication_status,
      max(r.submitted_at) as latest_message_at
    from public.cases c
    join public.people p on p.id = c.person_id
    join public.case_reports r on r.case_id = c.id
    where p.is_test_data = false
    group by c.id, c.slug, p.full_name, c.condition_status, c.publication_status
    order by max(r.submitted_at) desc
    limit p_limit
  ) thread;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (
    v_actor,
    'admin_case_message_threads_accessed',
    'case_messages',
    jsonb_build_object('threadCount', coalesce(v_count, 0))
  );

  return v_result;
end;
$$;

revoke all on function public.get_admin_case_message_threads(integer) from public, anon;
grant execute on function public.get_admin_case_message_threads(integer) to authenticated;

-- Keep the prior allow-listed diagnostic payload and advance only its schema
-- version plus the new authenticated RPC-presence checks.
alter function public.reports_debug_snapshot() rename to reports_debug_snapshot_v202608130002;
revoke all on function public.reports_debug_snapshot_v202608130002() from public, anon, authenticated;

create function public.reports_debug_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_last_migration text;
begin
  v_snapshot := public.reports_debug_snapshot_v202608130002();
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
      into v_last_migration;
  end if;

  return v_snapshot || jsonb_build_object(
    'schemaVersion', '202608130003',
    'lastMigrationApplied', v_last_migration,
    'rpcs', coalesce(v_snapshot -> 'rpcs', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('name', 'get_admin_people_cases', 'found', to_regprocedure('public.get_admin_people_cases(text,integer,integer)') is not null),
      jsonb_build_object('name', 'withdraw_person_case', 'found', to_regprocedure('public.withdraw_person_case(uuid,text)') is not null),
      jsonb_build_object('name', 'get_admin_case_message_threads', 'found', to_regprocedure('public.get_admin_case_message_threads(integer)') is not null)
    )
  );
end;
$$;

revoke all on function public.reports_debug_snapshot() from public, anon, authenticated;
grant execute on function public.reports_debug_snapshot() to service_role;

notify pgrst, 'reload schema';
