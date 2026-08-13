-- Public reporting, reviewed sightings and official deceased imports.
-- This migration is additive and intentionally does not expose private tables.

alter table public.case_reports
  add column if not exists public_description text
  check (public_description is null or char_length(public_description) between 10 and 800);

-- The existing safety trigger is BEFORE INSERT/UPDATE. Inserting a child
-- status_history row during BEFORE INSERT violates its FK because the case row
-- does not exist yet. New official cases record their initial history directly
-- in import_official_deceased, after the case insert. Updates remain automatic.
create or replace function public.case_safety_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.condition_status = 'deceased_confirmed' and (
    new.verification_level <> 'authority_confirmed'
    or nullif(btrim(new.authority_reference_private), '') is null
    or nullif(btrim(new.resolution_notes_private), '') is null
    or (
      not public.is_admin()
      and not (
        coalesce(current_setting('app.enable_test_data', true), 'false') = 'true'
        and exists (select 1 from public.people where id = new.person_id and is_test_data)
      )
    )
  ) then
    raise exception 'Only an admin can confirm a death with authority reference and reason';
  end if;

  if tg_op = 'UPDATE' and new.condition_status is distinct from old.condition_status then
    if auth.uid() is null then
      raise exception 'An actor is required';
    end if;

    insert into public.status_history (
      case_id, previous_condition, new_condition, previous_verification,
      new_verification, reason, authority_reference_private, actor_id
    ) values (
      new.id, old.condition_status, new.condition_status, old.verification_level,
      new.verification_level, coalesce(new.resolution_notes_private, 'Status update'),
      new.authority_reference_private, auth.uid()
    );

    insert into public.audit_logs (actor_id, action, entity_type, entity_id)
    values (auth.uid(), 'case_status_changed', 'case', new.id);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.case_safety_trigger() from public;

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.case_reports(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('approved','rejected','duplicate','escalated','request_information','official_deceased_import')),
  previous_status public.moderation_status,
  new_status public.moderation_status,
  reason text not null check (char_length(reason) between 3 and 1000),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (report_id is not null or case_id is not null)
);

alter table public.moderation_actions enable row level security;
revoke all on table public.moderation_actions from public, anon, authenticated;

-- The application service role is the only uploader. Files remain private
-- until a moderator deliberately creates a public media reference.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $storage$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'report-evidence',
        'report-evidence',
        false,
        8388608,
        array['image/jpeg','image/png','image/webp']
      )
      on conflict (id) do update set
        public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $storage$;
  end if;
end;
$$;

-- Preserve the audited core introduced by migration 003 and wrap it with
-- optional private media/contact persistence. The wrapper remains service-only.
alter function public.submit_public_report(jsonb) rename to submit_public_report_core;
revoke all on function public.submit_public_report_core(jsonb) from public, anon, authenticated, service_role;

create function public.submit_public_report(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
  v_tracking_code text;
  v_report_id uuid;
  v_case_id uuid;
  v_kind text;
  v_photo_path text;
  v_photo_mime text;
  v_photo_size integer;
  v_photo_name text;
  v_reporter_name text;
  v_phone text;
  v_email text;
  v_relationship text;
begin
  v_kind := nullif(btrim(p_payload ->> 'kind'), '');
  v_photo_path := nullif(btrim(p_payload ->> 'photoPath'), '');
  v_photo_mime := nullif(btrim(p_payload ->> 'photoMimeType'), '');
  v_photo_name := nullif(btrim(p_payload ->> 'photoOriginalName'), '');

  if v_photo_path is not null then
    if v_photo_path !~ '^reports/[0-9]{4}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      or v_photo_mime not in ('image/jpeg','image/png','image/webp')
      or nullif(p_payload ->> 'photoSize', '') is null then
      raise exception using errcode = '22023', message = 'Invalid private media metadata';
    end if;
    begin
      v_photo_size := (p_payload ->> 'photoSize')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid private media size';
    end;
    if v_photo_size < 1 or v_photo_size > 8388608 then
      raise exception using errcode = '22023', message = 'Invalid private media size';
    end if;
  end if;

  v_result := public.submit_public_report_core(p_payload);
  v_tracking_code := nullif(v_result ->> 'tracking_code', '');
  if v_tracking_code is null then
    raise exception using errcode = 'P0003', message = 'Core report submission returned no tracking code';
  end if;

  select r.id, r.case_id
  into v_report_id, v_case_id
  from public.case_reports r
  where r.tracking_code = v_tracking_code;

  if v_report_id is null or v_case_id is null then
    raise exception using errcode = 'P0003', message = 'Submitted report could not be resolved';
  end if;

  v_relationship := nullif(btrim(p_payload ->> 'relationship'), '');
  if v_relationship is not null and char_length(v_relationship) > 120 then
    raise exception using errcode = '22023', message = 'Relationship is too long';
  end if;

  if v_kind = 'missing_person' then
    update public.reporter_contacts
    set relationship_to_person = v_relationship
    where report_id = v_report_id;
  elsif v_kind = 'case_information' then
    v_reporter_name := nullif(btrim(p_payload ->> 'reporterName'), '');
    v_phone := nullif(btrim(p_payload ->> 'phone'), '');
    v_email := nullif(btrim(p_payload ->> 'email'), '');
    if v_phone is not null or v_email is not null or v_reporter_name is not null then
      insert into public.reporter_contacts (
        report_id,
        reporter_name,
        relationship_to_person,
        phone,
        email,
        preferred_contact_method
      ) values (
        v_report_id,
        coalesce(v_reporter_name, 'No informado'),
        v_relationship,
        v_phone,
        v_email,
        case when v_phone is not null then 'phone' when v_email is not null then 'email' else null end
      );
    end if;
  end if;

  if v_photo_path is not null then
    insert into public.media_assets (
      case_id,
      report_id,
      asset_type,
      storage_bucket,
      private_path,
      public_path,
      original_filename,
      detected_mime_type,
      size_bytes
    ) values (
      v_case_id,
      v_report_id,
      case when v_kind = 'missing_person' then 'portrait' else 'evidence' end,
      'report-evidence',
      v_photo_path,
      null,
      left(v_photo_name, 180),
      v_photo_mime,
      v_photo_size
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.submit_public_report(jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_report(jsonb) to service_role;

-- Add approved sightings to the public projection. Raw descriptions,
-- private locations and reporter contacts never enter this view.
create or replace view public.public_case_cards with (security_invoker=false) as
select
  c.id,
  c.slug,
  p.full_name,
  p.approximate_age,
  p.is_minor,
  c.condition_status,
  c.verification_level,
  c.urgency_level,
  c.last_seen_at,
  c.last_seen_location_public,
  ma.public_path as primary_public_photo_url,
  (
    select count(*)
    from public.case_reports r
    where r.case_id = c.id
      and r.moderation_status = 'approved'
      and r.report_type = 'sighting'
  )::int as approved_reports_count,
  c.updated_at,
  p.is_test_data,
  p.public_description,
  p.distinguishing_features,
  c.clothing,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'event_at', r.event_at,
      'location_public', r.location_public,
      'description', r.public_description,
      'reviewed_at', r.reviewed_at
    ) order by r.event_at desc nulls last, r.reviewed_at desc)
    from public.case_reports r
    where r.case_id = c.id
      and r.moderation_status = 'approved'
      and r.report_type = 'sighting'
      and r.public_description is not null
      and r.location_public is not null
  ), '[]'::jsonb) as sightings
from public.cases c
join public.people p on p.id = c.person_id
left join lateral (
  select public_path
  from public.media_assets
  where case_id = c.id
    and asset_type = 'portrait'
    and public_path is not null
  limit 1
) ma on true
where c.publication_status = 'published'
  and c.deleted_at is null;

revoke all on public.public_case_cards from public, anon, authenticated;

create or replace function public.get_pending_case_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'caseId', r.case_id,
      'caseSlug', c.slug,
      'personName', p.full_name,
      'reportType', r.report_type,
      'moderationStatus', r.moderation_status,
      'urgencyLevel', r.urgency_level,
      'eventAt', r.event_at,
      'locationPrivate', r.location_private,
      'descriptionPrivate', r.description,
      'submittedAt', r.submitted_at,
      'reporterName', rc.reporter_name,
      'phone', rc.phone,
      'email', rc.email,
      'relationship', rc.relationship_to_person,
      'hasEvidence', exists(select 1 from public.media_assets m where m.report_id = r.id)
    ) order by r.submitted_at asc)
    from public.case_reports r
    join public.cases c on c.id = r.case_id
    join public.people p on p.id = c.person_id
    left join public.reporter_contacts rc on rc.report_id = r.id
    where r.moderation_status in ('pending','escalated')
      and r.report_type in ('sighting','possible_trapped','possible_deceased','correction','other_information')
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_pending_case_reports() from public, anon;
grant execute on function public.get_pending_case_reports() to authenticated;

create or replace function public.moderate_case_report(
  p_report_id uuid,
  p_action text,
  p_reason text,
  p_public_location text default null,
  p_public_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_report public.case_reports%rowtype;
  v_next public.moderation_status;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;
  if p_action not in ('approved','rejected','duplicate','escalated','request_information') then
    raise exception using errcode = '22023', message = 'Invalid moderation action';
  end if;
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 1000 then
    raise exception using errcode = '22023', message = 'A moderation reason is required';
  end if;

  select * into v_report
  from public.case_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Report not found';
  end if;

  if p_action = 'approved' then
    v_next := 'approved';
    if v_report.report_type = 'sighting' and (
      nullif(btrim(p_public_location), '') is null
      or nullif(btrim(p_public_description), '') is null
      or char_length(btrim(p_public_description)) < 10
      or char_length(btrim(p_public_description)) > 800
    ) then
      raise exception using errcode = '22023', message = 'Approved sightings require a public approximate location and description';
    end if;
  elsif p_action = 'rejected' then
    v_next := 'rejected';
  elsif p_action = 'duplicate' then
    v_next := 'duplicate';
  elsif p_action = 'escalated' then
    v_next := 'escalated';
  else
    v_next := v_report.moderation_status;
  end if;

  if p_action <> 'request_information' then
    update public.case_reports
    set moderation_status = v_next,
        location_public = case when p_action = 'approved' then nullif(btrim(p_public_location), '') else location_public end,
        public_description = case when p_action = 'approved' then nullif(btrim(p_public_description), '') else public_description end,
        reviewed_at = now(),
        reviewed_by = v_actor,
        rejection_reason = case when p_action in ('rejected','duplicate') then btrim(p_reason) else null end,
        updated_at = now()
    where id = p_report_id;
  end if;

  insert into public.moderation_actions (
    report_id, actor_id, action, previous_status, new_status, reason
  ) values (
    p_report_id, v_actor, p_action, v_report.moderation_status, v_next, btrim(p_reason)
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'case_report_' || p_action, 'case_report', p_report_id, jsonb_build_object('reason', btrim(p_reason)));

  return jsonb_build_object('reportId', p_report_id, 'moderationStatus', v_next, 'caseStatusChanged', false);
end;
$$;

revoke all on function public.moderate_case_report(uuid,text,text,text,text) from public, anon;
grant execute on function public.moderate_case_report(uuid,text,text,text,text) to authenticated;

create or replace function public.preview_official_deceased_import(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item record;
  v_name text;
  v_normalized text;
  v_matches integer;
  v_case_id uuid;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Import must contain between 1 and 500 rows';
  end if;

  for v_item in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    v_name := nullif(btrim(v_item.value ->> 'full_name'), '');
    v_normalized := public.normalize_person_name(v_name);
    select count(*), min(c.id::text)::uuid
    into v_matches, v_case_id
    from public.people p
    left join public.cases c on c.person_id = p.id
    where p.normalized_name = v_normalized;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'row', v_item.ordinality,
      'fullName', v_name,
      'normalizedName', v_normalized,
      'matchCount', v_matches,
      'existingCaseId', v_case_id,
      'decision', case when v_matches = 0 then 'create' when v_matches = 1 then 'update' else 'review_required' end
    ));
  end loop;
  return v_result;
end;
$$;

revoke all on function public.preview_official_deceased_import(jsonb) from public, anon;
grant execute on function public.preview_official_deceased_import(jsonb) to authenticated;

create or replace function public.import_official_deceased(p_rows jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_name text;
  v_normalized text;
  v_source text;
  v_reference text;
  v_authority_reference text;
  v_description text;
  v_location text;
  v_gender text;
  v_age integer;
  v_confirmed_at timestamptz;
  v_match_count integer;
  v_person_id uuid;
  v_case public.cases%rowtype;
  v_case_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
begin
  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) < 10 or char_length(btrim(p_reason)) > 1000 then
    raise exception using errcode = '22023', message = 'An import reason between 10 and 1000 characters is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Import must contain between 1 and 500 rows';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(v_row ->> 'full_name'), '');
    v_source := nullif(btrim(v_row ->> 'source_name'), '');
    v_reference := nullif(btrim(v_row ->> 'source_reference'), '');
    v_description := nullif(btrim(v_row ->> 'public_description'), '');
    v_location := nullif(btrim(v_row ->> 'last_seen_location_public'), '');
    v_gender := nullif(btrim(v_row ->> 'gender'), '');

    if v_name is null or char_length(v_name) < 3 or char_length(v_name) > 140 then
      raise exception using errcode = '22023', message = 'Every imported person requires a valid full_name';
    end if;
    if lower(v_source) <> 'medicina legal' then
      raise exception using errcode = '22023', message = 'Only Medicina Legal is accepted as the official source in this importer';
    end if;
    if v_reference is not null and char_length(v_reference) > 500 then
      raise exception using errcode = '22023', message = 'source_reference is too long';
    end if;
    if v_description is not null and char_length(v_description) > 800 then
      raise exception using errcode = '22023', message = 'public_description is too long';
    end if;
    if v_location is not null and char_length(v_location) > 240 then
      raise exception using errcode = '22023', message = 'last_seen_location_public is too long';
    end if;
    if v_gender is not null and char_length(v_gender) > 80 then
      raise exception using errcode = '22023', message = 'gender is too long';
    end if;

    v_age := null;
    if nullif(btrim(v_row ->> 'approximate_age'), '') is not null then
      begin
        v_age := (v_row ->> 'approximate_age')::integer;
      exception when others then
        raise exception using errcode = '22023', message = 'approximate_age must be an integer';
      end;
      if v_age < 0 or v_age > 120 then
        raise exception using errcode = '22023', message = 'approximate_age must be between 0 and 120';
      end if;
    end if;

    v_confirmed_at := now();
    if nullif(btrim(v_row ->> 'date_confirmed'), '') is not null then
      begin
        v_confirmed_at := (((v_row ->> 'date_confirmed')::date + time '12:00') at time zone 'America/Bogota');
      exception when others then
        raise exception using errcode = '22023', message = 'date_confirmed must use YYYY-MM-DD';
      end;
    end if;

    v_normalized := public.normalize_person_name(v_name);
    select count(*), min(id::text)::uuid
    into v_match_count, v_person_id
    from public.people
    where normalized_name = v_normalized;
    if v_match_count > 1 then
      raise exception using errcode = 'P0003', message = 'Ambiguous duplicate requires manual review: ' || v_name;
    end if;

    if v_match_count = 0 then
      insert into public.people (
        full_name, approximate_age, is_minor, gender, public_description, is_test_data
      ) values (
        v_name, v_age, coalesce(v_age < 18, false), v_gender, v_description, false
      ) returning id into v_person_id;
      v_created := v_created + 1;
    else
      update public.people
      set approximate_age = coalesce(v_age, approximate_age),
          is_minor = case when v_age is null then is_minor else v_age < 18 end,
          gender = coalesce(v_gender, gender),
          public_description = coalesce(v_description, public_description),
          updated_at = now()
      where id = v_person_id;
      v_updated := v_updated + 1;
    end if;

    v_authority_reference := 'Medicina Legal' || case when v_reference is null then '' else ' — ' || v_reference end;
    select * into v_case from public.cases where person_id = v_person_id for update;
    if not found then
      insert into public.cases (
        person_id, slug, publication_status, condition_status, verification_level,
        urgency_level, last_seen_location_public, authority_reference_private,
        resolution_notes_private, resolved_at, published_at, primary_public_photo_path
      ) values (
        v_person_id,
        v_normalized || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
        'published', 'deceased_confirmed', 'authority_confirmed', 'normal',
        v_location, v_authority_reference, btrim(p_reason), v_confirmed_at, now(), null
      ) returning id into v_case_id;

      insert into public.status_history (
        case_id, previous_condition, new_condition, previous_verification,
        new_verification, reason, authority_reference_private, actor_id
      ) values (
        v_case_id, null, 'deceased_confirmed', null,
        'authority_confirmed', btrim(p_reason), v_authority_reference, v_actor
      );
    else
      v_case_id := v_case.id;
      update public.cases
      set publication_status = 'published',
          condition_status = 'deceased_confirmed',
          verification_level = 'authority_confirmed',
          urgency_level = 'normal',
          last_seen_location_public = coalesce(v_location, last_seen_location_public),
          authority_reference_private = v_authority_reference,
          resolution_notes_private = btrim(p_reason),
          resolved_at = v_confirmed_at,
          published_at = coalesce(published_at, now()),
          deleted_at = null
      where id = v_case_id;

      if v_case.condition_status = 'deceased_confirmed' then
        insert into public.status_history (
          case_id, previous_condition, new_condition, previous_verification,
          new_verification, reason, authority_reference_private, actor_id
        ) values (
          v_case_id, v_case.condition_status, 'deceased_confirmed', v_case.verification_level,
          'authority_confirmed', btrim(p_reason), v_authority_reference, v_actor
        );
      end if;
    end if;

    insert into public.moderation_actions (
      case_id, actor_id, action, reason, metadata
    ) values (
      v_case_id, v_actor, 'official_deceased_import', btrim(p_reason),
      jsonb_build_object('official', true, 'sourceName', 'Medicina Legal', 'sourceReferencePresent', v_reference is not null)
    );

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      v_actor, 'official_deceased_imported', 'case', v_case_id,
      jsonb_build_object('official', true, 'sourceName', 'Medicina Legal', 'sourceReferencePresent', v_reference is not null)
    );
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'total', jsonb_array_length(p_rows));
end;
$$;

revoke all on function public.import_official_deceased(jsonb,text) from public, anon;
grant execute on function public.import_official_deceased(jsonb,text) to authenticated;

create or replace function public.reports_debug_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_last_migration text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations' into v_last_migration;
  end if;
  return jsonb_build_object(
    'schemaVersion', '202608120004',
    'lastMigrationApplied', v_last_migration,
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'name', expected.name,
        'found', relation.oid is not null,
        'kind', case relation.relkind when 'r' then 'table' when 'v' then 'view' else null end,
        'rlsEnabled', case when relation.relkind = 'r' then relation.relrowsecurity else null end,
        'rlsForced', case when relation.relkind = 'r' then relation.relforcerowsecurity else null end
      ) order by expected.name)
      from unnest(array[
        'people','cases','case_reports','reporter_contacts','submission_rate_limits',
        'media_assets','moderation_actions','status_history','audit_logs','public_case_cards'
      ]) expected(name)
      left join pg_namespace namespace on namespace.nspname = 'public'
      left join pg_class relation on relation.relnamespace = namespace.oid and relation.relname = expected.name
    ),
    'rpcs', jsonb_build_array(
      jsonb_build_object('name', 'submit_public_report', 'found', to_regprocedure('public.submit_public_report(jsonb)') is not null),
      jsonb_build_object('name', 'get_public_case', 'found', to_regprocedure('public.get_public_case(text)') is not null),
      jsonb_build_object('name', 'search_public_people', 'found', to_regprocedure('public.search_public_people(text,text,integer,integer,integer,integer)') is not null),
      jsonb_build_object('name', 'get_pending_case_reports', 'found', to_regprocedure('public.get_pending_case_reports()') is not null),
      jsonb_build_object('name', 'moderate_case_report', 'found', to_regprocedure('public.moderate_case_report(uuid,text,text,text,text)') is not null),
      jsonb_build_object('name', 'import_official_deceased', 'found', to_regprocedure('public.import_official_deceased(jsonb,text)') is not null)
    )
  );
end;
$$;

revoke all on function public.reports_debug_snapshot() from public, anon, authenticated;
grant execute on function public.reports_debug_snapshot() to service_role;

notify pgrst, 'reload schema';
