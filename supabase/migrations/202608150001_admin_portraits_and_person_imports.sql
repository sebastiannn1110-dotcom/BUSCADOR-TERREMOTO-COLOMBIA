-- Audited public portraits and idempotent missing-person imports.
-- Public clients continue to read only the allow-listed public_case_cards view
-- through get_public_case/search_public_people.

alter table public.media_assets
  add column if not exists moderation_status public.moderation_status,
  add column if not exists content_sha256 text,
  add column if not exists retired_at timestamptz;

update public.media_assets
set moderation_status = 'approved'
where storage_bucket = 'public-portraits'
  and public_path is not null
  and moderation_status is null;

alter table public.media_assets
  drop constraint if exists media_assets_content_sha256_check;
alter table public.media_assets
  add constraint media_assets_content_sha256_check
  check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$');

create or replace function public.public_portrait_media_defaults()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.storage_bucket = 'public-portraits'
    and new.asset_type = 'portrait'
    and new.public_path is not null
    and new.moderation_status is null then
    new.moderation_status := 'approved';
  end if;
  return new;
end;
$$;

drop trigger if exists media_assets_public_portrait_defaults on public.media_assets;
create trigger media_assets_public_portrait_defaults
before insert on public.media_assets
for each row execute function public.public_portrait_media_defaults();

revoke all on function public.public_portrait_media_defaults() from public;

alter table public.moderation_actions
  drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions
  add constraint moderation_actions_action_check
  check (action in (
    'approved', 'rejected', 'duplicate', 'escalated',
    'request_information', 'official_deceased_import',
    'publish', 'reject', 'archive',
    'upload_public_portrait', 'replace_public_portrait',
    'remove_public_portrait', 'missing_person_import'
  ));

create table if not exists public.person_import_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  import_type text not null check (import_type in ('missing')),
  source_name text not null check (char_length(source_name) between 2 and 160),
  source_reference text not null check (char_length(source_reference) between 2 and 500),
  source_row text,
  normalized_name text not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[a-f0-9]{64}$'),
  department_disappearance text,
  municipality_disappearance text,
  verification_level public.verification_level not null,
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (source_row is null or char_length(source_row) <= 80),
  check (department_disappearance is null or char_length(department_disappearance) <= 120),
  check (municipality_disappearance is null or char_length(municipality_disappearance) <= 120)
);

create unique index if not exists person_import_entries_source_name_key
  on public.person_import_entries (
    import_type,
    lower(source_name),
    lower(source_reference),
    normalized_name
  );

create index if not exists person_import_entries_case_idx
  on public.person_import_entries (case_id);

alter table public.person_import_entries enable row level security;
alter table public.person_import_entries force row level security;
revoke all on table public.person_import_entries from public, anon, authenticated;

create or replace function public.missing_import_fingerprint(
  p_name text,
  p_department text,
  p_municipality text,
  p_source_name text,
  p_source_reference text,
  p_source_row text,
  p_description text,
  p_verification text
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(digest(convert_to(concat_ws(E'\x1f',
    public.normalize_person_name(p_name),
    lower(btrim(coalesce(p_department, ''))),
    lower(btrim(coalesce(p_municipality, ''))),
    lower(btrim(coalesce(p_source_name, ''))),
    lower(btrim(coalesce(p_source_reference, ''))),
    btrim(coalesce(p_source_row, '')),
    btrim(coalesce(p_description, '')),
    lower(btrim(coalesce(p_verification, '')))
  ), 'UTF8'), 'sha256'), 'hex')
$$;

revoke all on function public.missing_import_fingerprint(text,text,text,text,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.preview_missing_people_import(
  p_rows jsonb,
  p_verification_level text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_item record;
  v_name text;
  v_normalized text;
  v_department text;
  v_municipality text;
  v_source_name text;
  v_source_reference text;
  v_source_row text;
  v_description text;
  v_fingerprint text;
  v_batch_matches integer;
  v_people_matches integer;
  v_ledger_matches integer;
  v_ledger_case_id uuid;
  v_ledger_fingerprint text;
  v_decision text;
  v_review_reason text;
  v_result jsonb := '[]'::jsonb;
begin
  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if p_verification_level not in ('moderator_reviewed', 'authority_confirmed') then
    raise exception using errcode = '22023', message = 'Invalid missing-person verification level';
  end if;
  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Import must contain between 1 and 500 rows';
  end if;

  for v_item in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    v_name := nullif(btrim(v_item.value ->> 'full_name'), '');
    v_department := nullif(btrim(v_item.value ->> 'department_disappearance'), '');
    v_municipality := nullif(btrim(v_item.value ->> 'municipality_disappearance'), '');
    v_source_name := nullif(btrim(v_item.value ->> 'source_name'), '');
    v_source_reference := nullif(btrim(v_item.value ->> 'source_reference'), '');
    v_source_row := nullif(btrim(v_item.value ->> 'source_row'), '');
    v_description := nullif(btrim(v_item.value ->> 'public_description'), '');

    if v_name is null or char_length(v_name) not between 3 and 140 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': full_name must contain between 3 and 140 characters';
    end if;
    if v_source_name is null or char_length(v_source_name) not between 2 and 160 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_name is required';
    end if;
    if p_verification_level = 'authority_confirmed'
      and public.public_text_contains_contact_information(v_source_name) then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': public source name cannot contain phone numbers or email addresses';
    end if;
    if v_source_reference is null or char_length(v_source_reference) not between 2 and 500 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_reference is required';
    end if;
    if v_source_row is not null and char_length(v_source_row) > 80 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_row is too long';
    end if;
    if v_department is not null and char_length(v_department) > 120 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': department_disappearance is too long';
    end if;
    if v_municipality is not null and char_length(v_municipality) > 120 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': municipality_disappearance is too long';
    end if;
    if v_description is not null and char_length(v_description) > 800 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': public_description is too long';
    end if;
    if public.public_text_contains_contact_information(v_name)
      or public.public_text_contains_contact_information(v_department)
      or public.public_text_contains_contact_information(v_municipality)
      or public.public_text_contains_contact_information(v_description) then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': public fields cannot contain phone numbers or email addresses';
    end if;

    v_normalized := public.normalize_person_name(v_name);
    v_fingerprint := public.missing_import_fingerprint(
      v_name, v_department, v_municipality, v_source_name,
      v_source_reference, v_source_row, v_description, p_verification_level
    );

    select count(*) into v_batch_matches
    from jsonb_array_elements(p_rows) batch_row
    where public.normalize_person_name(nullif(btrim(batch_row ->> 'full_name'), '')) = v_normalized;

    select count(*) into v_people_matches
    from public.people
    where normalized_name = v_normalized;

    select count(*), min(case_id::text)::uuid, min(payload_fingerprint)
      into v_ledger_matches, v_ledger_case_id, v_ledger_fingerprint
    from public.person_import_entries
    where import_type = 'missing'
      and lower(source_name) = lower(v_source_name)
      and lower(source_reference) = lower(v_source_reference)
      and normalized_name = v_normalized;

    v_review_reason := null;
    if v_batch_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'homonym_in_file';
    elsif v_ledger_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'ambiguous_import_ledger';
    elsif v_ledger_matches = 1 and v_ledger_fingerprint = v_fingerprint then
      v_decision := 'already_imported';
    elsif v_ledger_matches = 1 then
      v_decision := 'review_required';
      v_review_reason := 'previous_import_payload_changed';
    elsif v_people_matches > 0 then
      v_decision := 'review_required';
      v_review_reason := 'existing_normalized_name_requires_manual_review';
    else
      v_decision := 'create';
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'row', v_item.ordinality,
      'sourceRow', v_source_row,
      'fullName', v_name,
      'normalizedName', v_normalized,
      'departmentDisappearance', v_department,
      'municipalityDisappearance', v_municipality,
      'matchCount', v_people_matches,
      'existingCaseId', v_ledger_case_id,
      'decision', v_decision,
      'reviewReason', v_review_reason
    ));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.preview_missing_people_import(jsonb,text) from public, anon;
grant execute on function public.preview_missing_people_import(jsonb,text) to authenticated;

create or replace function public.import_missing_people(
  p_rows jsonb,
  p_verification_level text,
  p_confirmed_official boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_preview jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_preview_row jsonb;
  v_name text;
  v_normalized text;
  v_department text;
  v_municipality text;
  v_source_name text;
  v_source_reference text;
  v_source_row text;
  v_description text;
  v_location text;
  v_fingerprint text;
  v_person_id uuid;
  v_case_id uuid;
  v_publication public.publication_status;
  v_created integer := 0;
  v_skipped integer := 0;
begin
  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'An import reason between 10 and 1000 characters is required';
  end if;
  if p_verification_level not in ('moderator_reviewed', 'authority_confirmed') then
    raise exception using errcode = '22023', message = 'Invalid missing-person verification level';
  end if;
  if p_verification_level = 'authority_confirmed' and coalesce(p_confirmed_official, false) is not true then
    raise exception using errcode = '22023', message = 'Official source confirmation is required';
  end if;

  v_preview := public.preview_missing_people_import(p_rows, p_verification_level);
  if exists (
    select 1 from jsonb_array_elements(v_preview) item
    where item ->> 'decision' = 'review_required'
  ) then
    raise exception using errcode = 'P0003', message = 'Import contains rows that require manual review';
  end if;

  for v_normalized in
    select distinct public.normalize_person_name(item ->> 'full_name')
    from jsonb_array_elements(p_rows) item
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('missing-person:' || v_normalized, 0));
  end loop;

  v_preview := public.preview_missing_people_import(p_rows, p_verification_level);
  if exists (
    select 1 from jsonb_array_elements(v_preview) item
    where item ->> 'decision' = 'review_required'
  ) then
    raise exception using errcode = 'P0003', message = 'Import contains rows that require manual review';
  end if;

  v_publication := case when p_verification_level = 'authority_confirmed'
    then 'published'::public.publication_status
    else 'pending_review'::public.publication_status end;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_preview_row := v_preview -> (v_index - 1);
    if v_preview_row ->> 'decision' = 'already_imported' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_name := nullif(btrim(v_row ->> 'full_name'), '');
    v_normalized := public.normalize_person_name(v_name);
    v_department := nullif(btrim(v_row ->> 'department_disappearance'), '');
    v_municipality := nullif(btrim(v_row ->> 'municipality_disappearance'), '');
    v_source_name := nullif(btrim(v_row ->> 'source_name'), '');
    v_source_reference := nullif(btrim(v_row ->> 'source_reference'), '');
    v_source_row := nullif(btrim(v_row ->> 'source_row'), '');
    v_description := nullif(btrim(v_row ->> 'public_description'), '');
    v_location := case
      when v_municipality is not null and v_department is not null then v_municipality || ', ' || v_department
      when v_municipality is not null then v_municipality
      else v_department
    end;
    v_fingerprint := public.missing_import_fingerprint(
      v_name, v_department, v_municipality, v_source_name,
      v_source_reference, v_source_row, v_description, p_verification_level
    );

    insert into public.people (
      full_name, approximate_age, is_minor, gender, public_description,
      private_notes, is_test_data
    ) values (
      v_name, null, false, null, v_description,
      'Fuente de importación registrada en person_import_entries.', false
    ) returning id into v_person_id;

    insert into public.cases (
      person_id, slug, publication_status, condition_status,
      verification_level, urgency_level, last_seen_location_public,
      reported_unit, authority_reference_private, reviewed_by,
      published_at, primary_public_photo_path, public_source_label
    ) values (
      v_person_id,
      v_normalized || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      v_publication, 'missing', p_verification_level::public.verification_level,
      'normal', v_location, v_location,
      case when p_verification_level = 'authority_confirmed' then v_source_reference else null end,
      v_actor,
      case when v_publication = 'published' then now() else null end,
      null,
      case when p_verification_level = 'authority_confirmed' then v_source_name else null end
    ) returning id into v_case_id;

    insert into public.status_history (
      case_id, previous_condition, new_condition, previous_verification,
      new_verification, reason, authority_reference_private, actor_id
    ) values (
      v_case_id, null, 'missing', null,
      p_verification_level::public.verification_level, btrim(p_reason),
      case when p_verification_level = 'authority_confirmed' then v_source_reference else null end,
      v_actor
    );

    insert into public.person_import_entries (
      case_id, import_type, source_name, source_reference, source_row,
      normalized_name, payload_fingerprint, department_disappearance,
      municipality_disappearance, verification_level, imported_by
    ) values (
      v_case_id, 'missing', v_source_name, v_source_reference, v_source_row,
      v_normalized, v_fingerprint, v_department, v_municipality,
      p_verification_level::public.verification_level, v_actor
    );

    insert into public.moderation_actions (case_id, actor_id, action, reason, metadata)
    values (
      v_case_id, v_actor, 'missing_person_import', btrim(p_reason),
      jsonb_build_object(
        'official', p_verification_level = 'authority_confirmed',
        'sourceName', v_source_name,
        'sourceReferencePresent', true,
        'sourceRowPresent', v_source_row is not null,
        'departmentPresent', v_department is not null,
        'municipalityPresent', v_municipality is not null,
        'publicationStatus', v_publication
      )
    );

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      v_actor, 'missing_person_imported', 'case', v_case_id,
      jsonb_build_object(
        'official', p_verification_level = 'authority_confirmed',
        'sourceName', v_source_name,
        'sourceReferencePresent', true,
        'sourceRowPresent', v_source_row is not null,
        'publicationStatus', v_publication
      )
    );
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', 0,
    'skipped', v_skipped,
    'published', case when v_publication = 'published' then v_created else 0 end,
    'pendingReview', case when v_publication = 'pending_review' then v_created else 0 end,
    'total', jsonb_array_length(p_rows)
  );
end;
$$;

revoke all on function public.import_missing_people(jsonb,text,boolean,text) from public, anon;
grant execute on function public.import_missing_people(jsonb,text,boolean,text) to authenticated;

create or replace function public.set_public_case_portrait(
  p_case_id uuid,
  p_public_path text,
  p_public_url text,
  p_size_bytes integer,
  p_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.cases%rowtype;
  v_path text := nullif(btrim(p_public_path), '');
  v_url text := nullif(btrim(p_public_url), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_action text;
begin
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'A portrait reason between 3 and 1000 characters is required';
  end if;
  if v_path !~ ('^portraits/' || p_case_id::text || '/[0-9a-f-]{36}\.jpg$')
    or v_path like '%..%'
    or v_url !~ '^https://[^[:space:]]+/storage/v1/object/public/public-portraits/'
    or right(v_url, char_length(v_path)) <> v_path
    or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 8388608
    or p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid public portrait metadata';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'public-portraits' and name = v_path
  ) then
    raise exception using errcode = 'P0002', message = 'Public portrait object was not found';
  end if;

  select * into v_case from public.cases where id = p_case_id for update;
  if not found or v_case.deleted_at is not null then
    raise exception using errcode = 'P0002', message = 'Case not found';
  end if;
  if v_case.condition_status not in ('missing', 'deceased_confirmed') then
    raise exception using errcode = '22023', message = 'Portraits can only be managed for missing or confirmed-deceased cases';
  end if;

  v_action := case when v_case.primary_public_photo_path is null
    then 'upload_public_portrait' else 'replace_public_portrait' end;

  update public.media_assets
  set public_path = null,
      moderation_status = 'rejected',
      retired_at = now()
  where case_id = p_case_id
    and asset_type = 'portrait'
    and storage_bucket = 'public-portraits'
    and private_path = v_case.primary_public_photo_path
    and public_path is not null;

  insert into public.media_assets (
    case_id, report_id, asset_type, storage_bucket, private_path, public_path,
    original_filename, detected_mime_type, size_bytes, moderation_status,
    content_sha256
  ) values (
    p_case_id, null, 'portrait', 'public-portraits', v_path, v_url,
    'retrato-publico.jpg', 'image/jpeg', p_size_bytes, 'approved', p_sha256
  );

  update public.cases
  set primary_public_photo_path = v_path,
      reviewed_by = v_actor,
      updated_at = now()
  where id = p_case_id;

  insert into public.moderation_actions (case_id, actor_id, action, reason, metadata)
  values (p_case_id, v_actor, v_action, v_reason,
    jsonb_build_object('sha256', p_sha256, 'sizeBytes', p_size_bytes));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, v_action, 'case', p_case_id,
    jsonb_build_object('sha256', p_sha256, 'sizeBytes', p_size_bytes));

  return jsonb_build_object(
    'caseId', p_case_id,
    'action', v_action,
    'oldObjectPath', v_case.primary_public_photo_path,
    'updated', true
  );
end;
$$;

revoke all on function public.set_public_case_portrait(uuid,text,text,integer,text,text)
  from public, anon;
grant execute on function public.set_public_case_portrait(uuid,text,text,integer,text,text)
  to authenticated;

create or replace function public.remove_public_case_portrait(
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
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'A portrait removal reason between 3 and 1000 characters is required';
  end if;

  select * into v_case from public.cases where id = p_case_id for update;
  if not found or v_case.deleted_at is not null then
    raise exception using errcode = 'P0002', message = 'Case not found';
  end if;
  if v_case.primary_public_photo_path is null then
    raise exception using errcode = 'P0001', message = 'Case has no current public portrait';
  end if;

  update public.media_assets
  set public_path = null,
      moderation_status = 'rejected',
      retired_at = now()
  where case_id = p_case_id
    and asset_type = 'portrait'
    and storage_bucket = 'public-portraits'
    and private_path = v_case.primary_public_photo_path
    and public_path is not null;

  update public.cases
  set primary_public_photo_path = null,
      reviewed_by = v_actor,
      updated_at = now()
  where id = p_case_id;

  insert into public.moderation_actions (case_id, actor_id, action, reason, metadata)
  values (p_case_id, v_actor, 'remove_public_portrait', v_reason, '{}'::jsonb);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'remove_public_portrait', 'case', p_case_id, jsonb_build_object('reason', v_reason));

  return jsonb_build_object(
    'caseId', p_case_id,
    'action', 'remove_public_portrait',
    'oldObjectPath', v_case.primary_public_photo_path,
    'removed', true
  );
end;
$$;

revoke all on function public.remove_public_case_portrait(uuid,text) from public, anon;
grant execute on function public.remove_public_case_portrait(uuid,text) to authenticated;

-- Individual photos are public only when the current case path points to the
-- approved media row. A generic memorial asset is not treated as a person's
-- photograph and therefore no longer replaces the explicit placeholder.
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
  portrait.public_url as primary_public_photo_url,
  approved.count::int as approved_reports_count,
  c.updated_at,
  p.is_test_data,
  p.public_description,
  null::text as distinguishing_features,
  null::text as clothing,
  approved.items as sightings,
  c.public_source_label,
  approved.latest_location as latest_approved_sighting_location,
  approved.items as approved_sightings,
  approved.count::int as approved_sightings_count,
  c.reported_unit
from public.cases c
join public.people p on p.id = c.person_id
left join lateral (
  select m.public_path as public_url
  from public.media_assets m
  where m.case_id = c.id
    and m.asset_type = 'portrait'
    and m.storage_bucket = 'public-portraits'
    and m.public_path is not null
    and c.primary_public_photo_path is not null
    and m.private_path = c.primary_public_photo_path
  order by m.created_at desc
  limit 1
) portrait on true
left join lateral (
  select
    count(*)::int as count,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', reviewed.id,
      'event_at', reviewed.event_at,
      'location_public', reviewed.location_public,
      'description', reviewed.public_description,
      'reviewed_at', reviewed.reviewed_at
    ) order by reviewed.event_at desc nulls last, reviewed.reviewed_at desc), '[]'::jsonb) as items,
    (array_agg(reviewed.location_public
      order by reviewed.event_at desc nulls last, reviewed.reviewed_at desc, reviewed.created_at desc))[1] as latest_location
  from public.case_reports reviewed
  where reviewed.case_id = c.id
    and reviewed.moderation_status = 'approved'
    and reviewed.report_type = 'sighting'
    and reviewed.public_description is not null
    and reviewed.location_public is not null
    and not public.public_text_contains_contact_information(reviewed.public_description)
    and not public.public_text_contains_contact_information(reviewed.location_public)
) approved on true
where c.publication_status = 'published'
  and c.deleted_at is null
  and p.is_test_data = false
  and not public.public_text_contains_contact_information(p.full_name)
  and not public.public_text_contains_contact_information(p.public_description)
  and not public.public_text_contains_contact_information(c.last_seen_location_public)
  and not public.public_text_contains_contact_information(c.public_source_label)
  and not public.public_text_contains_contact_information(c.reported_unit);

revoke all on public.public_case_cards from public, anon, authenticated;

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
    'publicPhotoUrl', managed.public_photo_url,
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
      c.deleted_at, c.updated_at, portrait.public_path as public_photo_url
    from public.cases c
    join public.people p on p.id = c.person_id
    left join lateral (
      select m.public_path
      from public.media_assets m
      where m.case_id = c.id
        and m.asset_type = 'portrait'
        and m.storage_bucket = 'public-portraits'
        and m.public_path is not null
        and m.private_path = c.primary_public_photo_path
      order by m.created_at desc limit 1
    ) portrait on true
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
  values (v_actor, 'admin_people_cases_accessed', 'case_queue',
    jsonb_build_object('resultCount', coalesce(v_count, 0), 'filtered', v_query is not null));
  return v_result;
end;
$$;

revoke all on function public.get_admin_people_cases(text,integer,integer) from public, anon;
grant execute on function public.get_admin_people_cases(text,integer,integer) to authenticated;

-- Preserve the established deceased import transaction and add optional gender
-- persistence without publishing that private/internal field.
create or replace function public.import_official_deceased_v2(p_rows jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_row jsonb;
  v_gender text;
  v_case_id uuid;
begin
  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  v_result := public.import_official_deceased(p_rows, p_reason);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_gender := nullif(btrim(v_row ->> 'gender'), '');
    if v_gender is not null and char_length(v_gender) > 40 then
      raise exception using errcode = '22023', message = 'gender is too long';
    end if;
    v_case_id := null;
    if nullif(btrim(v_row ->> 'source_row'), '') is not null then
      select e.case_id into v_case_id
      from public.official_deceased_import_entries e
      join public.people p on p.id = (select person_id from public.cases where id = e.case_id)
      where lower(e.source_reference) = lower(btrim(v_row ->> 'source_reference'))
        and e.source_row = (v_row ->> 'source_row')::integer
        and p.normalized_name = public.normalize_person_name(v_row ->> 'full_name')
      limit 1;
    else
      select c.id into v_case_id
      from public.cases c join public.people p on p.id = c.person_id
      where lower(btrim(c.authority_reference_private)) in (
        lower(btrim(v_row ->> 'source_reference')),
        lower('Medicina Legal — ' || btrim(v_row ->> 'source_reference'))
      )
        and p.normalized_name = public.normalize_person_name(v_row ->> 'full_name')
      limit 1;
    end if;
    if v_case_id is not null and v_gender is not null then
      update public.people p set gender = v_gender, updated_at = now()
      where p.id = (select c.person_id from public.cases c where c.id = v_case_id)
        and p.gender is distinct from v_gender;
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.import_official_deceased_v2(jsonb,text) from public, anon;
grant execute on function public.import_official_deceased_v2(jsonb,text) to authenticated;

-- Advance the allow-listed production diagnostic so deployments cannot report
-- healthy while this migration or its private ledger/RPC contracts are absent.
alter function public.reports_debug_snapshot() rename to reports_debug_snapshot_v202608130004;
revoke all on function public.reports_debug_snapshot_v202608130004() from public, anon, authenticated;

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
  v_import_ledger jsonb;
begin
  v_snapshot := public.reports_debug_snapshot_v202608130004();
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
      into v_last_migration;
  end if;

  select jsonb_build_object(
    'name', 'person_import_entries',
    'found', relation.oid is not null,
    'kind', case relation.relkind when 'r' then 'table' when 'v' then 'view' else null end,
    'rlsEnabled', case when relation.relkind = 'r' then relation.relrowsecurity else null end,
    'rlsForced', case when relation.relkind = 'r' then relation.relforcerowsecurity else null end
  )
  into v_import_ledger
  from (select 'person_import_entries'::text as name) expected
  left join pg_namespace namespace on namespace.nspname = 'public'
  left join pg_class relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.name;

  return v_snapshot || jsonb_build_object(
    'schemaVersion', '202608150001',
    'lastMigrationApplied', v_last_migration,
    'tables', coalesce(v_snapshot -> 'tables', '[]'::jsonb) || jsonb_build_array(v_import_ledger),
    'rpcs', coalesce(v_snapshot -> 'rpcs', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'name', 'preview_missing_people_import',
        'found', to_regprocedure('public.preview_missing_people_import(jsonb,text)') is not null
      ),
      jsonb_build_object(
        'name', 'import_missing_people',
        'found', to_regprocedure('public.import_missing_people(jsonb,text,boolean,text)') is not null
      ),
      jsonb_build_object(
        'name', 'set_public_case_portrait',
        'found', to_regprocedure('public.set_public_case_portrait(uuid,text,text,integer,text,text)') is not null
      ),
      jsonb_build_object(
        'name', 'remove_public_case_portrait',
        'found', to_regprocedure('public.remove_public_case_portrait(uuid,text)') is not null
      ),
      jsonb_build_object(
        'name', 'import_official_deceased_v2',
        'found', to_regprocedure('public.import_official_deceased_v2(jsonb,text)') is not null
      )
    )
  );
end;
$$;

revoke all on function public.reports_debug_snapshot() from public, anon, authenticated;
grant execute on function public.reports_debug_snapshot() to service_role;

notify pgrst, 'reload schema';
