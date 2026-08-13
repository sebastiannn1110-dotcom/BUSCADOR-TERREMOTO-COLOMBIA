-- Capture-safe official deceased imports and aggregate-only diagnostics.
-- This migration is additive/replacing only: migrations 001-005 remain intact.

alter table public.cases
  add column if not exists reported_unit text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.cases'::regclass
      and conname = 'cases_reported_unit_check'
  ) then
    alter table public.cases
      add constraint cases_reported_unit_check
      check (
        reported_unit is null
        or (
          reported_unit = btrim(reported_unit)
          and char_length(reported_unit) between 2 and 120
          and not public.public_text_contains_contact_information(reported_unit)
        )
      );
  end if;
end;
$$;

-- Existing Medicina Legal imports used last_seen_location_public for the
-- source's "Unidad Basica" value. Copy only that already-public, contact-safe
-- value. The safety trigger is restored even if the narrowly scoped backfill
-- fails; no status or authority field is changed.
do $$
begin
  execute 'alter table public.cases disable trigger cases_safety';
  begin
    update public.cases
    set reported_unit = btrim(last_seen_location_public)
    where reported_unit is null
      and condition_status = 'deceased_confirmed'
      and verification_level = 'authority_confirmed'
      and public_source_label = 'Medicina Legal'
      and char_length(btrim(last_seen_location_public)) between 2 and 120
      and not public.public_text_contains_contact_information(last_seen_location_public);
  exception when others then
    execute 'alter table public.cases enable trigger cases_safety';
    raise;
  end;
  execute 'alter table public.cases enable trigger cases_safety';
end;
$$;

create table if not exists public.official_deceased_import_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  source_reference text not null check (
    source_reference = btrim(source_reference)
    and char_length(source_reference) between 1 and 500
  ),
  source_row integer not null check (source_row > 0),
  payload_fingerprint text not null check (
    payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint official_deceased_import_entries_source_row_key
    unique (source_reference, source_row)
);

-- The RPC canonicalizes whitespace, and this index also makes case-only
-- variations collide instead of creating a second ledger entry.
create unique index if not exists official_deceased_import_entries_source_row_ci_key
  on public.official_deceased_import_entries (lower(source_reference), source_row);
create index if not exists official_deceased_import_entries_case_idx
  on public.official_deceased_import_entries (case_id);

alter table public.official_deceased_import_entries enable row level security;
alter table public.official_deceased_import_entries force row level security;
revoke all on table public.official_deceased_import_entries
  from public, anon, authenticated;

-- Hash only the canonical fields that the import is authorized to persist.
-- The helper is private: clients receive only a decision, never a hash derived
-- from a humanitarian row. Unknown CSV fields such as gender are excluded.
create or replace function public.official_deceased_import_fingerprint(
  p_full_name text,
  p_approximate_age integer,
  p_reported_unit text,
  p_public_description text,
  p_last_seen_location_public text,
  p_date_confirmed text,
  p_source_reference text,
  p_source_row integer
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'fullName', nullif(btrim(p_full_name), ''),
    'approximateAge', p_approximate_age,
    'reportedUnit', nullif(btrim(p_reported_unit), ''),
    'publicDescription', nullif(btrim(p_public_description), ''),
    'lastSeenLocationPublic', nullif(btrim(p_last_seen_location_public), ''),
    'dateConfirmed', nullif(btrim(p_date_confirmed), ''),
    'sourceReference', lower(nullif(btrim(p_source_reference), '')),
    'sourceRow', p_source_row
  )::text, 'UTF8')), 'hex')
$$;

revoke all on function public.official_deceased_import_fingerprint(
  text,integer,text,text,text,text,text,integer
) from public, anon, authenticated, service_role;

-- Keep all existing columns in their original order. reported_unit is the
-- only new public field and is appended for view/RPC compatibility.
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
    (array_agg(
      reviewed.location_public
      order by reviewed.event_at desc nulls last, reviewed.reviewed_at desc, reviewed.created_at desc
    ))[1] as latest_location
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

create or replace function public.search_public_people(
  query_text text default '',
  status_filter text default null,
  min_age int default null,
  max_age int default null,
  page_limit int default 24,
  page_offset int default 0
)
returns setof public.public_case_cards
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select v.*
  from public.public_case_cards v
  where (status_filter is null or v.condition_status::text = status_filter)
    and (min_age is null or v.approximate_age >= min_age)
    and (max_age is null or v.approximate_age <= max_age)
    and (
      coalesce(query_text, '') = ''
      or public.normalize_person_name(v.full_name) % public.normalize_person_name(query_text)
      or public.normalize_person_name(v.full_name) like public.normalize_person_name(query_text) || '%'
      or coalesce(v.last_seen_location_public, '') ilike '%' || query_text || '%'
      or coalesce(v.reported_unit, '') ilike '%' || query_text || '%'
      or coalesce(v.public_description, '') ilike '%' || query_text || '%'
    )
  order by
    similarity(public.normalize_person_name(v.full_name), public.normalize_person_name(coalesce(query_text, ''))) desc,
    v.updated_at desc
  limit least(greatest(page_limit, 1), 48)
  offset greatest(page_offset, 0)
$$;

create or replace function public.get_public_case(case_slug text)
returns setof public.public_case_cards
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select *
  from public.public_case_cards
  where slug = case_slug
$$;

revoke all on function public.search_public_people(text,text,int,int,int,int) from public;
revoke all on function public.get_public_case(text) from public;
grant execute on function public.search_public_people(text,text,int,int,int,int) to anon, authenticated;
grant execute on function public.get_public_case(text) to anon, authenticated;

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
  v_source text;
  v_reference text;
  v_legacy_authority_reference text;
  v_description text;
  v_location text;
  v_reported_unit text;
  v_age_text text;
  v_age integer;
  v_source_row_text text;
  v_source_row integer;
  v_date_confirmed text;
  v_payload_fingerprint text;
  v_name_matches integer;
  v_case_id uuid;
  v_batch_name_matches integer;
  v_batch_reference_matches integer;
  v_batch_composite_matches integer;
  v_reference_matches integer;
  v_reference_case_id uuid;
  v_reference_person_name text;
  v_reference_replay_eligible boolean;
  v_ledger_matches integer;
  v_ledger_case_id uuid;
  v_ledger_person_name text;
  v_ledger_payload_fingerprint text;
  v_decision text;
  v_review_reason text;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
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
    v_source := nullif(btrim(v_item.value ->> 'source_name'), '');
    v_reference := nullif(btrim(v_item.value ->> 'source_reference'), '');
    v_description := nullif(btrim(v_item.value ->> 'public_description'), '');
    v_location := nullif(btrim(v_item.value ->> 'last_seen_location_public'), '');
    v_reported_unit := nullif(btrim(v_item.value ->> 'reported_unit'), '');
    if v_name is null or char_length(v_name) < 3 or char_length(v_name) > 140 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': valid full_name is required';
    end if;
    if v_source is null or lower(v_source) <> 'medicina legal' then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': only Medicina Legal is accepted as the official source';
    end if;
    if v_reference is null then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_reference is required';
    end if;
    if char_length(v_reference) > 500 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_reference is too long';
    end if;
    if v_description is not null and char_length(v_description) > 800 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': public_description is too long';
    end if;
    if v_location is not null and char_length(v_location) > 240 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': last_seen_location_public is too long';
    end if;
    if v_reported_unit is not null and char_length(v_reported_unit) not between 2 and 120 then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': reported_unit must contain between 2 and 120 characters';
    end if;
    if public.public_text_contains_contact_information(v_name)
      or public.public_text_contains_contact_information(v_description)
      or public.public_text_contains_contact_information(v_location)
      or public.public_text_contains_contact_information(v_reported_unit) then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': public fields cannot contain phone numbers or email addresses';
    end if;

    v_age := null;
    v_age_text := nullif(btrim(v_item.value ->> 'approximate_age'), '');
    if v_age_text is not null then
      begin
        v_age := v_age_text::integer;
      exception when others then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': approximate_age must be an integer';
      end;
      if v_age < 0 or v_age > 120 then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': approximate_age must be between 0 and 120';
      end if;
    end if;

    v_source_row := null;
    v_source_row_text := nullif(btrim(v_item.value ->> 'source_row'), '');
    if v_source_row_text is not null then
      if v_source_row_text !~ '^[0-9]+$' then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_row must be a positive integer';
      end if;
      begin
        v_source_row := v_source_row_text::integer;
      exception when others then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_row must be a positive integer';
      end;
      if v_source_row <= 0 then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': source_row must be a positive integer';
      end if;
    end if;

    v_date_confirmed := nullif(btrim(v_item.value ->> 'date_confirmed'), '');
    if v_date_confirmed is not null then
      if v_date_confirmed !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': date_confirmed must use YYYY-MM-DD';
      end if;
      begin
        v_date_confirmed := v_date_confirmed::date::text;
      exception when others then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': date_confirmed must use YYYY-MM-DD';
      end;
    end if;

    v_normalized := public.normalize_person_name(v_name);
    v_legacy_authority_reference := 'Medicina Legal — ' || v_reference;
    v_payload_fingerprint := public.official_deceased_import_fingerprint(
      v_name, v_age, v_reported_unit, v_description, v_location,
      v_date_confirmed, v_reference, v_source_row
    );

    select count(*) into v_batch_name_matches
    from jsonb_array_elements(p_rows) batch_row
    where public.normalize_person_name(nullif(btrim(batch_row ->> 'full_name'), '')) = v_normalized;

    select count(*) into v_batch_reference_matches
    from jsonb_array_elements(p_rows) batch_row
    where lower(nullif(btrim(batch_row ->> 'source_reference'), '')) = lower(v_reference);

    v_batch_composite_matches := 0;
    if v_source_row is not null then
      select count(*) into v_batch_composite_matches
      from jsonb_array_elements(p_rows) batch_row
      where lower(nullif(btrim(batch_row ->> 'source_reference'), '')) = lower(v_reference)
        and nullif(btrim(batch_row ->> 'source_row'), '') ~ '^[0-9]+$'
        and coalesce(
          nullif(ltrim(btrim(batch_row ->> 'source_row'), '0'), ''),
          '0'
        ) = v_source_row::text;
    end if;

    select count(*), min(c.id::text)::uuid
    into v_name_matches, v_case_id
    from public.people p
    left join public.cases c on c.person_id = p.id
    where p.normalized_name = v_normalized;

    v_reference_matches := 0;
    v_reference_case_id := null;
    v_reference_person_name := null;
    v_reference_replay_eligible := false;
    v_ledger_matches := 0;
    v_ledger_case_id := null;
    v_ledger_person_name := null;
    v_ledger_payload_fingerprint := null;

    -- Exact legacy attribution is a replay signal only for a case that is
    -- already authority-confirmed deceased and attributed to Medicina Legal.
    -- Keep non-eligible matches in the count so they require manual review
    -- instead of silently creating or skipping a case.
    select
      count(*),
      min(c.id::text)::uuid,
      min(p.normalized_name),
      coalesce(bool_and(
        c.condition_status = 'deceased_confirmed'
        and c.verification_level = 'authority_confirmed'
        and lower(btrim(c.public_source_label)) = 'medicina legal'
      ), false)
    into
      v_reference_matches,
      v_reference_case_id,
      v_reference_person_name,
      v_reference_replay_eligible
    from public.cases c
    join public.people p on p.id = c.person_id
    where lower(btrim(c.authority_reference_private)) in (
      lower(v_reference), lower(v_legacy_authority_reference)
    );

    if v_source_row is not null then
      select
        count(*), min(e.case_id::text)::uuid, min(p.normalized_name),
        min(e.payload_fingerprint)
      into
        v_ledger_matches, v_ledger_case_id, v_ledger_person_name,
        v_ledger_payload_fingerprint
      from public.official_deceased_import_entries e
      join public.cases c on c.id = e.case_id
      join public.people p on p.id = c.person_id
      where lower(e.source_reference) = lower(v_reference)
        and e.source_row = v_source_row;
    end if;

    v_review_reason := null;
    if v_batch_name_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'duplicate_normalized_name_in_file';
    elsif v_batch_reference_matches > 1 and v_source_row is null then
      v_decision := 'review_required';
      -- Preserve the legacy reason while requiring source_row to distinguish
      -- records that legitimately share one source reference.
      v_review_reason := 'duplicate_source_reference_in_file';
    elsif v_batch_composite_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'duplicate_source_reference_row_in_file';
    elsif v_name_matches > 1 or v_ledger_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'ambiguous_existing_match';
    elsif v_source_row is not null
      and v_ledger_matches = 1
      and v_ledger_person_name <> v_normalized then
      v_decision := 'review_required';
      v_review_reason := 'source_reference_row_used_by_another_person';
    elsif v_source_row is not null
      and v_ledger_matches = 1
      and v_ledger_person_name = v_normalized
      and v_ledger_payload_fingerprint is distinct from v_payload_fingerprint then
      v_decision := 'review_required';
      v_review_reason := 'source_reference_row_payload_changed';
    elsif v_source_row is not null
      and v_ledger_matches = 1
      and v_ledger_person_name = v_normalized
      and v_ledger_payload_fingerprint = v_payload_fingerprint then
      v_decision := 'already_imported';
      v_case_id := v_ledger_case_id;
    elsif v_source_row is null and v_reference_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'ambiguous_existing_match';
    elsif v_source_row is null
      and v_reference_matches = 1
      and v_reference_person_name <> v_normalized then
      v_decision := 'review_required';
      v_review_reason := 'source_reference_used_by_another_person';
    elsif v_source_row is null
      and v_reference_matches = 1
      and v_reference_person_name = v_normalized
      and v_reference_replay_eligible then
      v_decision := 'already_imported';
      v_case_id := v_reference_case_id;
    elsif v_source_row is null
      and v_reference_matches = 1
      and v_reference_person_name = v_normalized then
      v_decision := 'review_required';
      v_review_reason := 'source_reference_existing_case_not_authority_confirmed';
    elsif v_name_matches = 0 then
      v_decision := 'create';
    else
      v_decision := 'review_required';
      v_review_reason := 'existing_normalized_name_requires_manual_review';
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'row', v_item.ordinality,
      'sourceRow', v_source_row,
      'reportedUnit', v_reported_unit,
      'fullName', v_name,
      'normalizedName', v_normalized,
      'sourceName', 'Medicina Legal',
      'sourceReferencePresent', true,
      'matchCount', v_name_matches,
      'existingCaseId', v_case_id,
      'decision', v_decision,
      'reviewReason', v_review_reason
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
  v_preview jsonb;
  v_preview_row jsonb;
  v_row jsonb;
  v_row_number integer := 0;
  v_name text;
  v_normalized text;
  v_reference text;
  v_description text;
  v_location text;
  v_reported_unit text;
  v_source_row integer;
  v_age integer;
  v_date_confirmed text;
  v_payload_fingerprint text;
  v_confirmed_at timestamptz;
  v_match_count integer;
  v_person_id uuid;
  v_case_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;
  if nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) < 10
    or char_length(btrim(p_reason)) > 1000 then
    raise exception using errcode = '22023', message = 'An import reason between 10 and 1000 characters is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Import must contain between 1 and 500 rows';
  end if;

  -- Validate and classify the whole file before mutating any humanitarian data.
  v_preview := public.preview_official_deceased_import(p_rows);
  if exists (
    select 1
    from jsonb_array_elements(v_preview) item
    where item ->> 'decision' = 'review_required'
  ) then
    raise exception using errcode = 'P0003', message = 'Import contains rows that require manual review';
  end if;

  -- Names prevent concurrent duplicate people. Composite official-source keys
  -- serialize ledger writes while allowing one source reference on many rows.
  for v_normalized in
    select distinct public.normalize_person_name(item ->> 'full_name')
    from jsonb_array_elements(p_rows) item
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('official-person:' || v_normalized, 0));
  end loop;

  for v_reference in
    select distinct
      lower(btrim(item ->> 'source_reference')) || ':' ||
      case
        when nullif(btrim(item ->> 'source_row'), '') is null then 'legacy'
        else coalesce(nullif(ltrim(btrim(item ->> 'source_row'), '0'), ''), '0')
      end
    from jsonb_array_elements(p_rows) item
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('medicina-legal:' || v_reference, 0));
  end loop;

  -- Reclassify under the locks. A competing transaction may have committed
  -- while this transaction was waiting.
  v_preview := public.preview_official_deceased_import(p_rows);
  if exists (
    select 1
    from jsonb_array_elements(v_preview) item
    where item ->> 'decision' = 'review_required'
  ) then
    raise exception using errcode = 'P0003', message = 'Import contains rows that require manual review';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_row_number := v_row_number + 1;
    v_preview_row := v_preview -> (v_row_number - 1);
    if v_preview_row ->> 'decision' = 'already_imported' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_name := nullif(btrim(v_row ->> 'full_name'), '');
    v_reference := nullif(btrim(v_row ->> 'source_reference'), '');
    v_description := nullif(btrim(v_row ->> 'public_description'), '');
    v_location := nullif(btrim(v_row ->> 'last_seen_location_public'), '');
    v_reported_unit := nullif(btrim(v_row ->> 'reported_unit'), '');
    v_source_row := null;
    if nullif(btrim(v_row ->> 'source_row'), '') is not null then
      v_source_row := (v_row ->> 'source_row')::integer;
    end if;

    -- Defense in depth; preview already applies the same public-data policy.
    if public.public_text_contains_contact_information(v_description)
      or public.public_text_contains_contact_information(v_location)
      or public.public_text_contains_contact_information(v_reported_unit) then
      raise exception using errcode = '22023', message = 'Row ' || v_row_number || ': public fields cannot contain phone numbers or email addresses';
    end if;

    v_age := null;
    if nullif(btrim(v_row ->> 'approximate_age'), '') is not null then
      begin
        v_age := (v_row ->> 'approximate_age')::integer;
      exception when others then
        raise exception using errcode = '22023', message = 'Row ' || v_row_number || ': approximate_age must be an integer';
      end;
      if v_age < 0 or v_age > 120 then
        raise exception using errcode = '22023', message = 'Row ' || v_row_number || ': approximate_age must be between 0 and 120';
      end if;
    end if;

    -- An omitted confirmation date remains unknown. Never substitute import
    -- time, because that would invent an official fact.
    v_confirmed_at := null;
    v_date_confirmed := nullif(btrim(v_row ->> 'date_confirmed'), '');
    if v_date_confirmed is not null then
      v_date_confirmed := v_date_confirmed::date::text;
      v_confirmed_at := ((v_date_confirmed::date + time '12:00') at time zone 'America/Bogota');
    end if;

    v_normalized := public.normalize_person_name(v_name);
    select count(*), min(id::text)::uuid
    into v_match_count, v_person_id
    from public.people
    where normalized_name = v_normalized;
    if v_match_count > 1 then
      raise exception using errcode = 'P0003', message = 'Ambiguous duplicate requires manual review: ' || v_name;
    end if;
    if v_match_count = 1 then
      -- Reaching this branch means preview did not identify an exact legacy or
      -- ledger replay. Never convert a name-only match automatically.
      raise exception using errcode = 'P0003', message = 'Existing normalized name requires manual review';
    end if;

    insert into public.people (
      full_name, approximate_age, is_minor, public_description, is_test_data
    ) values (
      v_name, v_age, coalesce(v_age < 18, false), v_description, false
    ) returning id into v_person_id;
    v_created := v_created + 1;

    -- Only brand-new people reach this point. Existing normalized names are
    -- review_required above, and exact replays are skipped before mutation.
    insert into public.cases (
      person_id, slug, publication_status, condition_status, verification_level,
      urgency_level, last_seen_location_public, reported_unit,
      authority_reference_private, resolution_notes_private, resolved_at,
      published_at, primary_public_photo_path, public_source_label
    ) values (
      v_person_id,
      v_normalized || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      'published', 'deceased_confirmed', 'authority_confirmed', 'normal',
      v_location, v_reported_unit, v_reference, btrim(p_reason),
      v_confirmed_at, now(), null, 'Medicina Legal'
    ) returning id into v_case_id;

    insert into public.status_history (
      case_id, previous_condition, new_condition, previous_verification,
      new_verification, reason, authority_reference_private, actor_id
    ) values (
      v_case_id, null, 'deceased_confirmed', null,
      'authority_confirmed', btrim(p_reason), v_reference, v_actor
    );

    if v_source_row is not null then
      v_payload_fingerprint := public.official_deceased_import_fingerprint(
        v_name, v_age, v_reported_unit, v_description, v_location,
        v_date_confirmed, v_reference, v_source_row
      );
      insert into public.official_deceased_import_entries (
        case_id, source_reference, source_row, payload_fingerprint, imported_by
      ) values (
        v_case_id, v_reference, v_source_row, v_payload_fingerprint, v_actor
      );
    end if;

    insert into public.moderation_actions (
      case_id, actor_id, action, reason, metadata
    ) values (
      v_case_id, v_actor, 'official_deceased_import', btrim(p_reason),
      jsonb_build_object(
        'official', true,
        'sourceName', 'Medicina Legal',
        'sourceReferencePresent', true,
        'sourceRowPresent', v_source_row is not null,
        'reportedUnitPresent', v_reported_unit is not null
      )
    );

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      v_actor, 'official_deceased_imported', 'case', v_case_id,
      jsonb_build_object(
        'official', true,
        'sourceName', 'Medicina Legal',
        'sourceReferencePresent', true,
        'sourceRowPresent', v_source_row is not null,
        'reportedUnitPresent', v_reported_unit is not null
      )
    );
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'alreadyImported', v_skipped,
    'total', jsonb_array_length(p_rows)
  );
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
  v_buckets jsonb;
  v_published_missing bigint;
  v_published_deceased bigint;
  v_deceased_filter_ready boolean;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
      into v_last_migration;
  end if;

  select
    count(*) filter (
      where c.publication_status = 'published'
        and c.condition_status = 'missing'
        and c.deleted_at is null
        and p.is_test_data = false
    ),
    count(*) filter (
      where c.publication_status = 'published'
        and c.condition_status = 'deceased_confirmed'
        and c.verification_level = 'authority_confirmed'
        and c.deleted_at is null
        and p.is_test_data = false
    )
  into v_published_missing, v_published_deceased
  from public.cases c
  join public.people p on p.id = c.person_id;

  select
    to_regclass('public.public_case_cards') is not null
    and to_regprocedure('public.search_public_people(text,text,integer,integer,integer,integer)') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'public_case_cards'
        and column_name = 'reported_unit'
    )
    and not exists (
      select 1
      from public.public_case_cards
      where condition_status = 'deceased_confirmed'
        and verification_level <> 'authority_confirmed'
    )
  into v_deceased_filter_ready;

  if to_regclass('storage.buckets') is not null then
    execute $buckets$
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', expected.name,
        'found', bucket.id is not null,
        'public', bucket.public,
        'fileSizeLimit', bucket.file_size_limit,
        'allowedMimeTypes', to_jsonb(bucket.allowed_mime_types)
      ) order by expected.name), '[]'::jsonb)
      from unnest(array['report-evidence', 'public-portraits']) expected(name)
      left join storage.buckets bucket on bucket.id = expected.name
    $buckets$ into v_buckets;
  else
    v_buckets := jsonb_build_array(
      jsonb_build_object(
        'name', 'public-portraits', 'found', false, 'public', null,
        'fileSizeLimit', null, 'allowedMimeTypes', null
      ),
      jsonb_build_object(
        'name', 'report-evidence', 'found', false, 'public', null,
        'fileSizeLimit', null, 'allowedMimeTypes', null
      )
    );
  end if;

  return jsonb_build_object(
    'schemaVersion', '202608130002',
    'lastMigrationApplied', v_last_migration,
    'publishedCounts', jsonb_build_object(
      'missing', v_published_missing,
      'deceasedConfirmed', v_published_deceased
    ),
    'deceasedFilterReady', v_deceased_filter_ready,
    'tables', (
      select jsonb_agg(jsonb_build_object(
        'name', expected.name,
        'found', relation.oid is not null,
        'kind', case relation.relkind
          when 'r' then 'table'
          when 'v' then 'view'
          else null
        end,
        'rlsEnabled', case when relation.relkind = 'r' then relation.relrowsecurity else null end,
        'rlsForced', case when relation.relkind = 'r' then relation.relforcerowsecurity else null end
      ) order by expected.name)
      from unnest(array[
        'people', 'cases', 'case_reports', 'reporter_contacts',
        'submission_rate_limits', 'media_assets', 'moderation_actions',
        'contact_followups', 'official_deceased_import_entries',
        'status_history', 'audit_logs', 'public_case_cards'
      ]) expected(name)
      left join pg_namespace namespace on namespace.nspname = 'public'
      left join pg_class relation
        on relation.relnamespace = namespace.oid
       and relation.relname = expected.name
    ),
    'rpcs', jsonb_build_array(
      jsonb_build_object('name', 'submit_public_report', 'found', to_regprocedure('public.submit_public_report(jsonb)') is not null),
      jsonb_build_object('name', 'get_public_case', 'found', to_regprocedure('public.get_public_case(text)') is not null),
      jsonb_build_object('name', 'search_public_people', 'found', to_regprocedure('public.search_public_people(text,text,integer,integer,integer,integer)') is not null),
      jsonb_build_object('name', 'get_pending_people_cases', 'found', to_regprocedure('public.get_pending_people_cases()') is not null),
      jsonb_build_object('name', 'review_pending_person_case', 'found', to_regprocedure('public.review_pending_person_case(uuid,text,text,text,text,uuid,text,text)') is not null),
      jsonb_build_object('name', 'get_pending_case_reports', 'found', to_regprocedure('public.get_pending_case_reports()') is not null),
      jsonb_build_object('name', 'moderate_case_report', 'found', to_regprocedure('public.moderate_case_report(uuid,text,text,text,text)') is not null),
      jsonb_build_object('name', 'get_contact_followup_queue', 'found', to_regprocedure('public.get_contact_followup_queue()') is not null),
      jsonb_build_object('name', 'log_contact_followup', 'found', to_regprocedure('public.log_contact_followup(uuid,uuid,uuid,text,text,text,text,timestamp with time zone)') is not null),
      jsonb_build_object('name', 'get_staff_media_asset', 'found', to_regprocedure('public.get_staff_media_asset(uuid)') is not null),
      jsonb_build_object('name', 'preview_official_deceased_import', 'found', to_regprocedure('public.preview_official_deceased_import(jsonb)') is not null),
      jsonb_build_object('name', 'import_official_deceased', 'found', to_regprocedure('public.import_official_deceased(jsonb,text)') is not null),
      jsonb_build_object('name', 'bootstrap_initial_admin', 'found', to_regprocedure('public.bootstrap_initial_admin(uuid,text,text)') is not null),
      jsonb_build_object('name', 'manage_staff_profile', 'found', to_regprocedure('public.manage_staff_profile(uuid,text,public.app_role,boolean,text)') is not null)
    ),
    'buckets', v_buckets
  );
end;
$$;

revoke all on function public.reports_debug_snapshot() from public, anon, authenticated;
grant execute on function public.reports_debug_snapshot() to service_role;

notify pgrst, 'reload schema';
