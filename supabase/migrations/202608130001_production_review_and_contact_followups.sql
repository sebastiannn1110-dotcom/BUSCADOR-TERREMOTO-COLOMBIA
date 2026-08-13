-- Production review, safe public attribution and private contact follow-up.
-- This migration is additive/replacing only: migrations 001-004 remain intact.

alter table public.cases
  add column if not exists public_source_label text;

alter table public.case_reports
  add column if not exists report_context text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cases'::regclass
      and conname = 'cases_public_source_label_check'
  ) then
    alter table public.cases
      add constraint cases_public_source_label_check
      check (
        public_source_label is null
        or char_length(btrim(public_source_label)) between 3 and 120
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.case_reports'::regclass
      and conname = 'case_reports_report_context_check'
  ) then
    alter table public.case_reports
      add constraint case_reports_report_context_check
      check (
        report_context is null
        or (
          report_type = 'sighting'
          and report_context in ('sighting_alive', 'sighting_care')
        )
      );
  end if;
end;
$$;

-- Backfill only records that already satisfy the authoritative death contract
-- and whose private reference is unambiguously attributed to Medicina Legal.
-- The label is display metadata only and never relaxes the death constraints.
update public.cases
set public_source_label = 'Medicina Legal'
where condition_status = 'deceased_confirmed'
  and verification_level = 'authority_confirmed'
  and public_source_label is null
  and lower(btrim(authority_reference_private)) ~ '^medicina legal($|[[:space:]]|—|-)';

create or replace function public.is_moderator_or_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and role in ('moderator', 'admin')
  )
$$;

revoke all on function public.is_moderator_or_admin() from public, anon;
grant execute on function public.is_moderator_or_admin() to authenticated, service_role;

-- Published prose must never become a covert contact channel. This helper
-- detects conventional email addresses and phone-like runs containing seven
-- or more digits, even when spaces, parentheses, dots or hyphens are used.
create or replace function public.public_text_contains_contact_information(p_value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_candidate text[];
  v_scan text := p_value;
begin
  if p_value is null or btrim(p_value) = '' then
    return false;
  end if;

  if p_value ~* '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}' then
    return true;
  end if;

  -- Do not mistake ordinary written dates for phone numbers.
  v_scan := regexp_replace(v_scan, '[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}', ' ', 'g');
  v_scan := regexp_replace(v_scan, '[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4}', ' ', 'g');

  for v_candidate in
    select regexp_matches(v_scan, '\+?[0-9][[:space:][:punct:]0-9]{5,}[0-9]', 'g')
  loop
    if char_length(regexp_replace(v_candidate[1], '[^0-9]', '', 'g')) >= 7 then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function public.public_text_contains_contact_information(text)
  from public, anon, authenticated;

-- Defense in depth: RLS is not a substitute for table privileges. All
-- sensitive mutations are performed only inside audited security-definer RPCs.
revoke insert, update, delete on table
  public.people,
  public.cases,
  public.case_reports,
  public.reporter_contacts,
  public.media_assets,
  public.moderation_actions,
  public.status_history,
  public.audit_logs
from public, anon, authenticated;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create table if not exists public.contact_followups (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  report_id uuid references public.case_reports(id) on delete set null,
  contact_id uuid references public.reporter_contacts(id) on delete set null,
  target_type text not null check (
    target_type in ('reportante_inicial', 'informante', 'familia', 'otro')
  ),
  contact_method text not null check (
    contact_method in ('llamada', 'whatsapp', 'sms', 'correo', 'presencial', 'otro')
  ),
  contact_status text not null check (
    contact_status in (
      'pendiente', 'contactado', 'no_respondio', 'numero_errado',
      'requiere_seguimiento', 'cerrado'
    )
  ),
  summary_private text not null check (
    char_length(btrim(summary_private)) between 3 and 2000
  ),
  next_followup_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists contact_followups_case_created_idx
  on public.contact_followups (case_id, created_at desc);
create index if not exists contact_followups_report_created_idx
  on public.contact_followups (report_id, created_at desc)
  where report_id is not null;
create index if not exists contact_followups_contact_created_idx
  on public.contact_followups (contact_id, created_at desc)
  where report_id is null and contact_id is not null;
create index if not exists contact_followups_next_idx
  on public.contact_followups (next_followup_at)
  where next_followup_at is not null
    and contact_status in ('pendiente', 'requiere_seguimiento');

create or replace function public.validate_contact_followup_relations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contact_report_id uuid;
  v_contact_case_id uuid;
begin
  if new.report_id is not null and not exists (
    select 1 from public.case_reports
    where id = new.report_id and case_id = new.case_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'The report does not belong to the selected case';
  end if;

  if new.contact_id is not null then
    select rc.report_id, r.case_id
    into v_contact_report_id, v_contact_case_id
    from public.reporter_contacts rc
    join public.case_reports r on r.id = rc.report_id
    where rc.id = new.contact_id;

    if not found or v_contact_case_id <> new.case_id then
      raise exception using
        errcode = '23503',
        message = 'The contact does not belong to the selected case';
    end if;
    if new.report_id is not null and v_contact_report_id <> new.report_id then
      raise exception using
        errcode = '23503',
        message = 'The contact does not belong to the selected report';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_contact_followup_relations() from public;
drop trigger if exists contact_followups_relations on public.contact_followups;
create trigger contact_followups_relations
before insert or update of case_id, report_id, contact_id
on public.contact_followups
for each row execute function public.validate_contact_followup_relations();

alter table public.contact_followups enable row level security;
revoke all on table public.contact_followups from public, anon, authenticated;
-- Authenticated staff reads through RLS. Writes are deliberately available
-- only through log_contact_followup(), which creates the matching audit row.
grant select on table public.contact_followups to authenticated;

drop policy if exists contact_followups_staff_select on public.contact_followups;
create policy contact_followups_staff_select
on public.contact_followups
for select
to authenticated
using (public.is_staff());

drop policy if exists contact_followups_moderator_insert on public.contact_followups;
-- No INSERT policy: log_contact_followup() is the sole audited write path.

drop policy if exists contact_followups_admin_delete on public.contact_followups;
-- Follow-up history is append-only. No role receives direct UPDATE or DELETE;
-- a future deletion workflow must be an explicitly audited admin-only RPC.

-- Public portraits are deliberately separated from private report evidence.
-- Upload/copy remains a server-side service-role operation.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $storage$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'public-portraits',
        'public-portraits',
        true,
        8388608,
        array['image/jpeg']
      )
      on conflict (id) do update set
        public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $storage$;
  end if;
end;
$$;

-- Keep every existing column in its original order. New public-only fields are
-- appended so the composite view type and existing clients remain compatible.
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
  approved.count::int as approved_sightings_count
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
  and not public.public_text_contains_contact_information(c.public_source_label);

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

-- Migration 003 logged PG_EXCEPTION_DETAIL and PG_EXCEPTION_CONTEXT. Both can
-- contain rejected values or statement context with humanitarian PII. Preserve
-- actionable diagnostics while never logging/returning payload values.
create or replace function public.submit_public_report_core(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_kind text;
  v_case_reference text;
  v_case_id uuid;
  v_report_type_text text;
  v_report_type public.report_type;
  v_event_at timestamptz;
  v_location text;
  v_description text;
  v_full_name text;
  v_normalized_name text;
  v_alias text;
  v_age_text text;
  v_age integer;
  v_is_minor boolean;
  v_last_seen_at timestamptz;
  v_clothing text;
  v_features text;
  v_circumstances text;
  v_reporter_name text;
  v_phone text;
  v_email text;
  v_preferred_contact text;
  v_person_id uuid;
  v_report_id uuid;
  v_tracking_code text;
  v_request_fingerprint text;
  v_submission_count integer;
  v_now timestamptz := clock_timestamp();
  v_step text := 'Request received';
  v_error_code text;
  v_error_message text;
  v_error_constraint text;
  v_error_table text;
  v_error_column text;
  v_error_schema text;
  v_error_datatype text;
begin
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);

  v_step := 'Validating payload';
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid report payload';
  end if;

  v_request_fingerprint := nullif(btrim(p_payload ->> 'requestFingerprint'), '');
  if v_request_fingerprint is null or v_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid submission fingerprint';
  end if;

  v_step := 'Updating submission rate limit';
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);
  insert into public.submission_rate_limits as limits (
    request_fingerprint, window_started_at, submission_count, updated_at
  ) values (
    v_request_fingerprint, v_now, 1, v_now
  ) on conflict (request_fingerprint) do update set
    window_started_at = case
      when limits.window_started_at <= v_now - interval '15 minutes' then v_now
      else limits.window_started_at
    end,
    submission_count = case
      when limits.window_started_at <= v_now - interval '15 minutes' then 1
      else limits.submission_count + 1
    end,
    updated_at = v_now
  returning submission_count into v_submission_count;

  if v_submission_count > 5 then
    raise exception using errcode = 'P0001', message = 'Submission rate limit reached';
  end if;

  v_kind := nullif(btrim(p_payload ->> 'kind'), '');
  if v_kind is null or v_kind not in ('missing_person', 'case_information') then
    raise exception using errcode = '22023', message = 'Invalid report kind';
  end if;

  if v_kind = 'case_information' then
    v_case_reference := nullif(btrim(p_payload ->> 'caseId'), '');
    if v_case_reference is null
      or v_case_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Invalid case reference';
    end if;

    v_step := 'Finding public case';
    raise log '[REPORTS] %', jsonb_build_object('step', v_step);
    select c.id into v_case_id
    from public.cases c
    where c.id = v_case_reference::uuid
      and c.publication_status = 'published'
      and c.deleted_at is null
    for key share;
    if v_case_id is null then
      raise exception using errcode = 'P0002', message = 'Case is not available for public reports';
    end if;

    v_report_type_text := nullif(btrim(p_payload ->> 'reportType'), '');
    if v_report_type_text is null or v_report_type_text not in (
      'sighting', 'possible_trapped', 'possible_deceased',
      'correction', 'other_information'
    ) then
      raise exception using errcode = '22023', message = 'Invalid report type';
    end if;
    v_report_type := v_report_type_text::public.report_type;

    v_location := nullif(btrim(p_payload ->> 'location'), '');
    if v_location is not null and char_length(v_location) > 240 then
      raise exception using errcode = '22023', message = 'Location is too long';
    end if;

    v_description := nullif(btrim(p_payload ->> 'description'), '');
    if v_description is null
      or char_length(v_description) < 10
      or char_length(v_description) > 3000 then
      raise exception using errcode = '22023', message = 'Description must be between 10 and 3000 characters';
    end if;

    if nullif(btrim(p_payload ->> 'eventAt'), '') is not null then
      begin
        v_event_at := (p_payload ->> 'eventAt')::timestamptz;
      exception when others then
        raise exception using errcode = '22023', message = 'Invalid event timestamp';
      end;
    end if;

    v_step := 'Creating report';
    raise log '[REPORTS] %', jsonb_build_object('step', v_step);
    insert into public.case_reports (
      case_id, report_type, event_at, location_private, location_public,
      description, urgency_level, is_sensitive
    ) values (
      v_case_id, v_report_type, v_event_at, v_location, null, v_description,
      case when v_report_type = 'possible_trapped'
        then 'urgent'::public.urgency_level
        else 'normal'::public.urgency_level
      end,
      true
    ) returning id, tracking_code into v_report_id, v_tracking_code;

    raise log '[REPORTS] %', jsonb_build_object('step', 'Finished successfully');
    return jsonb_build_object('tracking_code', v_tracking_code);
  end if;

  v_full_name := nullif(btrim(p_payload ->> 'fullName'), '');
  if v_full_name is null or char_length(v_full_name) < 3 or char_length(v_full_name) > 140 then
    raise exception using errcode = '22023', message = 'Full name must be between 3 and 140 characters';
  end if;
  v_normalized_name := public.normalize_person_name(v_full_name);
  if v_normalized_name = '' then
    raise exception using errcode = '22023', message = 'Full name cannot be normalized';
  end if;

  v_alias := nullif(btrim(p_payload ->> 'alias'), '');
  if v_alias is not null and char_length(v_alias) > 140 then
    raise exception using errcode = '22023', message = 'Alias is too long';
  end if;

  v_age_text := nullif(btrim(p_payload ->> 'approximateAge'), '');
  if v_age_text is not null then
    if v_age_text !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'Invalid approximate age';
    end if;
    v_age := v_age_text::integer;
    if v_age > 120 then
      raise exception using errcode = '22023', message = 'Invalid approximate age';
    end if;
  end if;

  if jsonb_typeof(p_payload -> 'isMinor') <> 'boolean' then
    raise exception using errcode = '22023', message = 'isMinor must be a boolean';
  end if;
  v_is_minor := (p_payload ->> 'isMinor')::boolean;

  if nullif(btrim(p_payload ->> 'lastSeenAt'), '') is null then
    raise exception using errcode = '22023', message = 'Last seen timestamp is required';
  end if;
  begin
    v_last_seen_at := (p_payload ->> 'lastSeenAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'Invalid last seen timestamp';
  end;

  v_location := nullif(btrim(p_payload ->> 'location'), '');
  if v_location is null or char_length(v_location) < 3 or char_length(v_location) > 240 then
    raise exception using errcode = '22023', message = 'Location must be between 3 and 240 characters';
  end if;

  v_clothing := nullif(btrim(p_payload ->> 'clothing'), '');
  v_features := nullif(btrim(p_payload ->> 'features'), '');
  v_circumstances := nullif(btrim(p_payload ->> 'circumstances'), '');
  if (v_clothing is not null and char_length(v_clothing) > 800)
    or (v_features is not null and char_length(v_features) > 800)
    or (v_circumstances is not null and char_length(v_circumstances) > 3000) then
    raise exception using errcode = '22023', message = 'Report detail is too long';
  end if;

  v_reporter_name := nullif(btrim(p_payload ->> 'reporterName'), '');
  if v_reporter_name is null
    or char_length(v_reporter_name) < 2
    or char_length(v_reporter_name) > 140 then
    raise exception using errcode = '22023', message = 'Reporter name must be between 2 and 140 characters';
  end if;

  v_phone := nullif(btrim(p_payload ->> 'phone'), '');
  if v_phone is not null and (
    char_length(v_phone) < 7
    or char_length(v_phone) > 40
    or v_phone !~ '^[0-9+ ()-]+$'
  ) then
    raise exception using errcode = '22023', message = 'Invalid phone number';
  end if;

  v_email := nullif(btrim(p_payload ->> 'email'), '');
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception using errcode = '22023', message = 'Invalid email address';
  end if;
  if v_phone is null and v_email is null then
    raise exception using errcode = '22023', message = 'A contact method is required';
  end if;

  v_preferred_contact := nullif(btrim(p_payload ->> 'preferredContact'), '');
  if v_preferred_contact is not null and char_length(v_preferred_contact) > 40 then
    raise exception using errcode = '22023', message = 'Preferred contact method is too long';
  end if;

  v_step := 'Creating person';
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);
  insert into public.people (
    full_name, aliases, approximate_age, is_minor,
    distinguishing_features, private_notes
  ) values (
    v_full_name,
    case when v_alias is null then '{}'::text[] else array[v_alias] end,
    v_age, v_is_minor, v_features, v_circumstances
  ) returning id into v_person_id;

  v_step := 'Creating case';
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);
  insert into public.cases (
    person_id, slug, publication_status, condition_status, last_seen_at,
    last_seen_location_public, last_seen_location_private, clothing,
    circumstances_public, circumstances_private, urgency_level
  ) values (
    v_person_id,
    v_normalized_name || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'pending_review', 'missing', v_last_seen_at, null, v_location, v_clothing,
    null, v_circumstances,
    case when v_is_minor
      then 'priority'::public.urgency_level
      else 'normal'::public.urgency_level
    end
  ) returning id into v_case_id;

  v_step := 'Creating report';
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);
  insert into public.case_reports (
    case_id, report_type, description, is_sensitive
  ) values (
    v_case_id, 'other_information', 'Reporte inicial de persona desaparecida', true
  ) returning id, tracking_code into v_report_id, v_tracking_code;

  v_step := 'Creating reporter contact';
  raise log '[REPORTS] %', jsonb_build_object('step', v_step);
  insert into public.reporter_contacts (
    report_id, reporter_name, phone, email, preferred_contact_method
  ) values (
    v_report_id, v_reporter_name, v_phone, v_email, v_preferred_contact
  );

  raise log '[REPORTS] %', jsonb_build_object('step', 'Finished successfully');
  return jsonb_build_object('tracking_code', v_tracking_code);
exception when others then
  get stacked diagnostics
    v_error_code = returned_sqlstate,
    v_error_message = message_text,
    v_error_constraint = constraint_name,
    v_error_table = table_name,
    v_error_column = column_name,
    v_error_schema = schema_name,
    v_error_datatype = pg_datatype_name;

  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'error', jsonb_strip_nulls(jsonb_build_object(
      'code', v_error_code,
      'name', 'PostgresError',
      'constraint', nullif(v_error_constraint, ''),
      'table', nullif(v_error_table, ''),
      'column', nullif(v_error_column, ''),
      'schema', nullif(v_error_schema, ''),
      'datatype', nullif(v_error_datatype, '')
    ))
  );

  raise exception using
    errcode = v_error_code,
    message = 'Report submission failed at step: ' || coalesce(v_step, 'unknown'),
    detail = jsonb_strip_nulls(jsonb_build_object(
      'reportStep', v_step,
      'constraint', nullif(v_error_constraint, ''),
      'table', nullif(v_error_table, ''),
      'column', nullif(v_error_column, ''),
      'schema', nullif(v_error_schema, ''),
      'datatype', nullif(v_error_datatype, '')
    ))::text,
    hint = 'Use reportStep and schema metadata to locate the failing SQL statement';
end;
$$;

revoke all on function public.submit_public_report_core(jsonb)
  from public, anon, authenticated, service_role;

-- Extend the service-only submission wrapper without weakening the validated
-- and fully logged core from migration 003.
create or replace function public.submit_public_report(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_effective_payload jsonb := p_payload;
  v_result jsonb;
  v_tracking_code text;
  v_report_id uuid;
  v_case_id uuid;
  v_kind text;
  v_report_type text;
  v_report_context text;
  v_age_text text;
  v_age integer;
  v_photo_path text;
  v_photo_mime text;
  v_photo_size integer;
  v_photo_name text;
  v_reporter_name text;
  v_phone text;
  v_email text;
  v_relationship text;
  v_consent_at timestamptz;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid report payload';
  end if;

  v_kind := nullif(btrim(p_payload ->> 'kind'), '');
  v_report_type := nullif(btrim(p_payload ->> 'reportType'), '');
  v_report_context := nullif(btrim(p_payload ->> 'reportContext'), '');
  v_phone := nullif(btrim(p_payload ->> 'phone'), '');

  if v_report_context is not null and (
    v_report_type <> 'sighting'
    or v_report_context not in ('sighting_alive', 'sighting_care')
  ) then
    raise exception using errcode = '22023', message = 'Invalid report context';
  end if;
  if v_report_type = 'sighting'
    and nullif(btrim(p_payload ->> 'location'), '') is null then
    raise exception using errcode = '22023', message = 'Sightings require an approximate location';
  end if;
  if (
    v_report_type in ('possible_trapped', 'possible_deceased')
    or v_report_context = 'sighting_care'
  ) and v_phone is null then
    raise exception using errcode = '22023', message = 'This report requires a contact phone number';
  end if;

  -- Age is the source of truth. Unknown age receives the safer minor privacy
  -- posture; a client cannot opt out by sending isMinor=false.
  if v_kind = 'missing_person' then
    v_age_text := nullif(btrim(p_payload ->> 'approximateAge'), '');
    if v_age_text is null then
      v_effective_payload := jsonb_set(v_effective_payload, '{isMinor}', 'true'::jsonb, true);
    else
      if v_age_text !~ '^[0-9]{1,3}$' then
        raise exception using errcode = '22023', message = 'Invalid approximate age';
      end if;
      v_age := v_age_text::integer;
      if v_age > 120 then
        raise exception using errcode = '22023', message = 'Invalid approximate age';
      end if;
      v_effective_payload := jsonb_set(
        v_effective_payload,
        '{isMinor}',
        to_jsonb(v_age < 18),
        true
      );
    end if;
  end if;

  if nullif(btrim(p_payload ->> 'consentAt'), '') is not null then
    begin
      v_consent_at := (p_payload ->> 'consentAt')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid consent timestamp';
    end;
    if v_consent_at > now() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'Invalid consent timestamp';
    end if;
  end if;

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

  v_result := public.submit_public_report_core(v_effective_payload);
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
    set relationship_to_person = v_relationship,
        consent_at = now()
    where report_id = v_report_id;

    update public.case_reports
    set description = 'Reporte inicial de persona desaparecida',
        updated_at = now()
    where id = v_report_id;
  elsif v_kind = 'case_information' then
    v_reporter_name := nullif(btrim(p_payload ->> 'reporterName'), '');
    v_email := nullif(btrim(p_payload ->> 'email'), '');
    if v_phone is not null or v_email is not null or v_reporter_name is not null then
      insert into public.reporter_contacts (
        report_id,
        reporter_name,
        relationship_to_person,
        phone,
        email,
        preferred_contact_method,
        consent_at
      ) values (
        v_report_id,
        coalesce(v_reporter_name, 'No informado'),
        v_relationship,
        v_phone,
        v_email,
        case when v_phone is not null then 'phone' when v_email is not null then 'email' else null end,
        now()
      );
    end if;

    update public.case_reports
    set report_context = v_report_context,
        updated_at = now()
    where id = v_report_id;
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

-- Safely extend the action vocabulary without changing historical values.
alter table public.moderation_actions
  drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions
  add constraint moderation_actions_action_check
  check (action in (
    'approved', 'rejected', 'duplicate', 'escalated',
    'request_information', 'official_deceased_import',
    'publish', 'reject', 'archive'
  ));

create or replace function public.get_pending_people_cases()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_case_ids uuid[];
begin
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', pending.case_id,
      'caseId', pending.case_id,
      'slug', pending.slug,
      'personId', pending.person_id,
      'fullName', pending.full_name,
      'approximateAge', pending.approximate_age,
      'isMinor', pending.is_minor,
      'lastSeenAt', pending.last_seen_at,
      'locationPrivate', pending.last_seen_location_private,
      'descriptionPrivate', pending.circumstances_private,
      'clothing', pending.clothing,
      'distinguishingFeatures', pending.distinguishing_features,
      'trackingCode', pending.tracking_code,
      'createdAt', pending.created_at,
      'reviewState', 'pending_review',
      'reporterName', pending.reporter_name,
      'phone', pending.phone,
      'email', pending.email,
      'consentAt', pending.consent_at,
      'evidenceAssets', pending.evidence_assets
    ) order by pending.created_at asc), '[]'::jsonb),
    coalesce(array_agg(pending.case_id), '{}'::uuid[])
  into v_result, v_case_ids
  from (
    select
      c.id as case_id,
      c.slug,
      c.person_id,
      p.full_name,
      p.approximate_age,
      p.is_minor,
      p.distinguishing_features,
      c.last_seen_at,
      c.last_seen_location_private,
      c.circumstances_private,
      c.clothing,
      c.created_at,
      initial_report.tracking_code,
      rc.reporter_name,
      rc.phone,
      rc.email,
      rc.consent_at,
      coalesce(media.items, '[]'::jsonb) as evidence_assets
    from public.cases c
    join public.people p on p.id = c.person_id
    left join lateral (
      select r.id, r.tracking_code
      from public.case_reports r
      where r.case_id = c.id
      order by r.created_at asc, r.id asc
      limit 1
    ) initial_report on true
    left join public.reporter_contacts rc on rc.report_id = initial_report.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'assetType', m.asset_type,
        'mimeType', m.detected_mime_type,
        'sizeBytes', m.size_bytes,
        'originalFilename', m.original_filename
      ) order by m.created_at asc) as items
      from public.media_assets m
      where m.case_id = c.id
        and m.report_id = initial_report.id
    ) media on true
    where c.publication_status = 'pending_review'
      and c.deleted_at is null
      and c.condition_status = 'missing'
      and p.is_test_data = false
  ) pending;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (
    v_actor,
    'pending_people_contacts_accessed',
    'case_queue',
    jsonb_build_object(
      'caseCount', coalesce(cardinality(v_case_ids), 0),
      'caseIds', to_jsonb(v_case_ids)
    )
  );

  return v_result;
end;
$$;

revoke all on function public.get_pending_people_cases() from public, anon;
grant execute on function public.get_pending_people_cases() to authenticated;

create or replace function public.review_pending_person_case(
  p_case_id uuid,
  p_action text,
  p_reason text,
  p_public_description text default null,
  p_public_location text default null,
  p_source_media_asset_id uuid default null,
  p_public_photo_path text default null,
  p_public_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.cases%rowtype;
  v_person public.people%rowtype;
  v_source_media public.media_assets%rowtype;
  v_next_publication public.publication_status;
  v_public_description text := nullif(btrim(p_public_description), '');
  v_public_location text := nullif(btrim(p_public_location), '');
  v_public_path text := nullif(btrim(p_public_photo_path), '');
  v_public_url text := nullif(btrim(p_public_photo_url), '');
begin
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;
  if p_action not in ('publish', 'reject', 'duplicate', 'request_information', 'archive') then
    raise exception using errcode = '22023', message = 'Invalid pending case review action';
  end if;
  if nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) < 3
    or char_length(btrim(p_reason)) > 1000 then
    raise exception using errcode = '22023', message = 'A review reason between 3 and 1000 characters is required';
  end if;

  select * into v_case
  from public.cases
  where id = p_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pending case not found';
  end if;
  if v_case.publication_status <> 'pending_review'
    or v_case.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'Case is no longer pending review';
  end if;
  if v_case.condition_status <> 'missing' then
    raise exception using errcode = '22023', message = 'This review flow can only handle missing-person cases';
  end if;

  select * into v_person
  from public.people
  where id = v_case.person_id
  for update;

  if p_action = 'publish' then
    if v_public_description is not null
      and (char_length(v_public_description) < 3 or char_length(v_public_description) > 800) then
      raise exception using errcode = '22023', message = 'Public description must be between 3 and 800 characters';
    end if;
    if v_public_location is null or char_length(v_public_location) > 240 then
      raise exception using errcode = '22023', message = 'Publishing requires a safe approximate public location';
    end if;
    if public.public_text_contains_contact_information(v_person.full_name)
      or public.public_text_contains_contact_information(v_public_description)
      or public.public_text_contains_contact_information(v_public_location) then
      raise exception using errcode = '22023', message = 'Public fields cannot contain phone numbers or email addresses';
    end if;

    if p_source_media_asset_id is null then
      if v_public_path is not null or v_public_url is not null then
        raise exception using errcode = '22023', message = 'Public photo metadata requires a reviewed source asset';
      end if;
    else
      if v_public_path is null or v_public_url is null then
        raise exception using errcode = '22023', message = 'Approved public photo requires path and URL metadata';
      end if;
      select * into v_source_media
      from public.media_assets
      where id = p_source_media_asset_id
        and case_id = p_case_id
        and storage_bucket = 'report-evidence'
        and public_path is null
        and asset_type = 'portrait'
      for key share;
      if not found then
        raise exception using errcode = '22023', message = 'Source portrait does not belong to this case';
      end if;
      if v_source_media.detected_mime_type not in ('image/jpeg','image/png','image/webp')
        or v_source_media.size_bytes is null
        or v_source_media.size_bytes < 1
        or v_source_media.size_bytes > 8388608 then
        raise exception using errcode = '22023', message = 'Source portrait metadata is not safe for publication';
      end if;

      -- The server re-encodes reviewed portraits as JPEG, which strips EXIF
      -- metadata (including embedded coordinates) before public storage.
      if v_public_path !~ ('^portraits/' || p_case_id::text || '/[0-9a-f-]{36}\.jpg$')
        or v_public_path like '%..%'
        or v_public_url !~ '^https://[^[:space:]]+/storage/v1/object/public/public-portraits/'
        or right(v_public_url, char_length(v_public_path)) <> v_public_path then
        raise exception using errcode = '22023', message = 'Invalid approved public portrait metadata';
      end if;
      if not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'public-portraits'
          and o.name = v_public_path
      ) then
        raise exception using errcode = 'P0002', message = 'Approved public portrait was not found in storage';
      end if;

      insert into public.media_assets (
        case_id, report_id, asset_type, storage_bucket, private_path, public_path,
        original_filename, detected_mime_type, size_bytes
      ) values (
        p_case_id, v_source_media.report_id, 'portrait', 'public-portraits', v_public_path,
        v_public_url, 'retrato-publico.jpg',
        'image/jpeg', null
      );
    end if;

    update public.people
    set public_description = v_public_description,
        updated_at = now()
    where id = v_case.person_id;

    update public.cases
    set publication_status = 'published',
        condition_status = 'missing',
        verification_level = 'moderator_reviewed',
        last_seen_location_public = v_public_location,
        circumstances_public = v_public_description,
        primary_public_photo_path = v_public_path,
        reviewed_by = v_actor,
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = p_case_id;
    v_next_publication := 'published';

    insert into public.status_history (
      case_id, previous_condition, new_condition, previous_verification,
      new_verification, reason, actor_id
    ) values (
      p_case_id, v_case.condition_status, 'missing', v_case.verification_level,
      'moderator_reviewed', btrim(p_reason), v_actor
    );
  elsif p_action = 'request_information' then
    v_next_publication := 'pending_review';
  else
    v_next_publication := case when p_action = 'archive'
      then 'archived'::public.publication_status
      else 'hidden'::public.publication_status
    end;
    update public.cases
    set publication_status = v_next_publication,
        reviewed_by = v_actor,
        updated_at = now()
    where id = p_case_id;
  end if;

  if p_action <> 'request_information' then
    update public.case_reports
    set moderation_status = case p_action
          when 'publish' then 'approved'::public.moderation_status
          when 'duplicate' then 'duplicate'::public.moderation_status
          else 'rejected'::public.moderation_status
        end,
        reviewed_at = now(),
        reviewed_by = v_actor,
        rejection_reason = case
          when p_action in ('reject', 'duplicate', 'archive') then btrim(p_reason)
          else null
        end,
        updated_at = now()
    where id = (
      select initial_report.id
      from public.case_reports initial_report
      where initial_report.case_id = p_case_id
      order by initial_report.created_at asc, initial_report.id asc
      limit 1
    );
  end if;

  insert into public.moderation_actions (
    case_id, actor_id, action, reason, metadata
  ) values (
    p_case_id,
    v_actor,
    p_action,
    btrim(p_reason),
    jsonb_strip_nulls(jsonb_build_object(
      'previousPublicationStatus', v_case.publication_status,
      'newPublicationStatus', v_next_publication,
      'publicPortraitApproved', p_source_media_asset_id is not null,
      'sourceMediaAssetId', p_source_media_asset_id
    ))
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'pending_person_case_' || p_action,
    'case',
    p_case_id,
    jsonb_strip_nulls(jsonb_build_object(
      'reason', btrim(p_reason),
      'previousPublicationStatus', v_case.publication_status,
      'newPublicationStatus', v_next_publication,
      'sourceMediaAssetId', p_source_media_asset_id
    ))
  );

  return jsonb_build_object(
    'caseId', p_case_id,
    'action', p_action,
    'publicationStatus', v_next_publication,
    'published', v_next_publication = 'published',
    'slug', v_case.slug
  );
end;
$$;

revoke all on function public.review_pending_person_case(uuid,text,text,text,text,uuid,text,text) from public, anon;
grant execute on function public.review_pending_person_case(uuid,text,text,text,text,uuid,text,text) to authenticated;

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
  v_reason text := nullif(btrim(p_reason), '');
  v_public_location text := nullif(btrim(p_public_location), '');
  v_public_description text := nullif(btrim(p_public_description), '');
begin
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;
  if p_action not in ('approved', 'rejected', 'duplicate', 'escalated', 'request_information') then
    raise exception using errcode = '22023', message = 'Invalid moderation action';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'A moderation reason between 3 and 1000 characters is required';
  end if;

  select * into v_report
  from public.case_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Report not found';
  end if;
  if v_report.moderation_status not in ('pending', 'escalated') then
    raise exception using errcode = 'P0001', message = 'Report is no longer pending moderation';
  end if;

  if p_action = 'approved' then
    if v_report.report_type <> 'sighting' then
      raise exception using errcode = '22023', message = 'Only sightings can be approved for public display';
    end if;
    if v_public_location is null or char_length(v_public_location) > 240 then
      raise exception using errcode = '22023', message = 'Approved sightings require a public approximate location of at most 240 characters';
    end if;
    if v_public_description is null
      or char_length(v_public_description) < 10
      or char_length(v_public_description) > 800 then
      raise exception using errcode = '22023', message = 'Approved sightings require a public description between 10 and 800 characters';
    end if;
    if public.public_text_contains_contact_information(v_public_location)
      or public.public_text_contains_contact_information(v_public_description) then
      raise exception using errcode = '22023', message = 'Public fields cannot contain phone numbers or email addresses';
    end if;
    v_next := 'approved';
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
        location_public = case when p_action = 'approved' then v_public_location else location_public end,
        public_description = case when p_action = 'approved' then v_public_description else public_description end,
        reviewed_at = now(),
        reviewed_by = v_actor,
        rejection_reason = case when p_action in ('rejected', 'duplicate') then v_reason else null end,
        updated_at = now()
    where id = p_report_id;
  end if;

  insert into public.moderation_actions (
    report_id, actor_id, action, previous_status, new_status, reason
  ) values (
    p_report_id, v_actor, p_action, v_report.moderation_status, v_next, v_reason
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'case_report_' || p_action,
    'case_report',
    p_report_id,
    jsonb_build_object('reason', v_reason)
  );

  return jsonb_build_object(
    'reportId', p_report_id,
    'moderationStatus', v_next,
    'caseStatusChanged', false
  );
end;
$$;

revoke all on function public.moderate_case_report(uuid,text,text,text,text) from public, anon;
grant execute on function public.moderate_case_report(uuid,text,text,text,text) to authenticated;

create or replace function public.get_pending_case_reports()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_report_ids uuid[];
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', queue.id,
      'caseId', queue.case_id,
      'caseSlug', queue.slug,
      'personName', queue.full_name,
      'reportType', queue.report_type,
      'reportContext', queue.report_context,
      'moderationStatus', queue.moderation_status,
      'urgencyLevel', queue.urgency_level,
      'eventAt', queue.event_at,
      'locationPrivate', queue.location_private,
      'descriptionPrivate', queue.description,
      'submittedAt', queue.submitted_at,
      'reporterName', queue.reporter_name,
      'phone', queue.phone,
      'email', queue.email,
      'relationship', queue.relationship_to_person,
      'hasEvidence', queue.has_evidence,
      'evidenceAssets', queue.evidence_assets
    ) order by queue.submitted_at asc), '[]'::jsonb),
    coalesce(array_agg(queue.id), '{}'::uuid[])
  into v_result, v_report_ids
  from (
    select
      r.id,
      r.case_id,
      c.slug,
      p.full_name,
      r.report_type,
      r.report_context,
      r.moderation_status,
      r.urgency_level,
      r.event_at,
      r.location_private,
      r.description,
      r.submitted_at,
      rc.reporter_name,
      rc.phone,
      rc.email,
      rc.relationship_to_person,
      media.items is not null as has_evidence,
      coalesce(media.items, '[]'::jsonb) as evidence_assets
    from public.case_reports r
    join public.cases c on c.id = r.case_id
    join public.people p on p.id = c.person_id
    left join public.reporter_contacts rc on rc.report_id = r.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'assetType', m.asset_type,
        'mimeType', m.detected_mime_type,
        'sizeBytes', m.size_bytes,
        'originalFilename', m.original_filename
      ) order by m.created_at asc) as items
      from public.media_assets m
      where m.report_id = r.id
    ) media on true
    where r.moderation_status in ('pending', 'escalated')
      and r.report_type in (
        'sighting', 'possible_trapped', 'possible_deceased',
        'correction', 'other_information'
      )
      and not (
        c.publication_status = 'pending_review'
        and r.id = (
          select first_report.id
          from public.case_reports first_report
          where first_report.case_id = c.id
          order by first_report.created_at asc, first_report.id asc
          limit 1
        )
      )
  ) queue;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (
    v_actor,
    'pending_case_report_contacts_accessed',
    'case_report_queue',
    jsonb_build_object(
      'reportCount', coalesce(cardinality(v_report_ids), 0),
      'reportIds', to_jsonb(v_report_ids)
    )
  );

  return v_result;
end;
$$;

revoke all on function public.get_pending_case_reports() from public, anon;
grant execute on function public.get_pending_case_reports() to authenticated;

create or replace function public.get_contact_followup_queue()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_report_ids uuid[];
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'caseId', queue.case_id,
      'reportId', queue.report_id,
      'contactId', queue.contact_id,
      'personName', queue.full_name,
      'caseSlug', queue.slug,
      'reportType', queue.report_type,
      'reportContext', queue.report_context,
      'urgencyLevel', queue.urgency_level,
      'moderationStatus', queue.moderation_status,
      'submittedAt', queue.submitted_at,
      'eventAt', queue.event_at,
      'locationPrivate', queue.location_private,
      'descriptionPrivate', queue.description,
      'reporterName', queue.reporter_name,
      'phone', queue.phone,
      'email', queue.email,
      'relationship', queue.relationship_to_person,
      'initialContact', queue.initial_contact,
      'lastFollowupStatus', queue.last_followup_status,
      'nextFollowupAt', queue.next_followup_at,
      'followupCount', queue.followup_count,
      'hasEvidence', queue.has_evidence
    ) order by
      case queue.urgency_level
        when 'critical' then 1 when 'urgent' then 2 when 'priority' then 3 else 4
      end,
      queue.submitted_at asc), '[]'::jsonb),
    coalesce(array_agg(queue.report_id), '{}'::uuid[])
  into v_result, v_report_ids
  from (
    select
      c.id as case_id,
      r.id as report_id,
      rc.id as contact_id,
      p.full_name,
      c.slug,
      r.report_type,
      r.report_context,
      r.urgency_level,
      r.moderation_status,
      r.submitted_at,
      r.event_at,
      r.location_private,
      r.description,
      rc.reporter_name,
      rc.phone,
      rc.email,
      rc.relationship_to_person,
      case when initial_contact.id is null then null else jsonb_build_object(
        'contactId', initial_contact.id,
        'reporterName', initial_contact.reporter_name,
        'phone', initial_contact.phone,
        'email', initial_contact.email,
        'relationship', initial_contact.relationship_to_person
      ) end as initial_contact,
      followup.contact_status as last_followup_status,
      followup.next_followup_at,
      coalesce(followup_count.count, 0)::int as followup_count,
      exists(select 1 from public.media_assets m where m.report_id = r.id) as has_evidence
    from public.case_reports r
    join public.cases c on c.id = r.case_id
    join public.people p on p.id = c.person_id
    left join public.reporter_contacts rc on rc.report_id = r.id
    left join lateral (
      select first_report.id
      from public.case_reports first_report
      where first_report.case_id = c.id
      order by first_report.created_at asc, first_report.id asc
      limit 1
    ) initial_report on true
    left join public.reporter_contacts initial_contact
      on initial_contact.report_id = initial_report.id
    left join lateral (
      select f.contact_status, f.next_followup_at
      from public.contact_followups f
      where f.case_id = c.id
        and (
          f.report_id = r.id
          or (
            f.report_id is null
            and (
              -- A follow-up submitted from another report using the initial
              -- contact is scoped to that contact's own report row only.
              (f.contact_id is not null and f.contact_id = rc.id)
              -- Legacy case-level rows without a contact are confined to the
              -- canonical initial report instead of affecting every report.
              or (f.contact_id is null and r.id = initial_report.id)
            )
          )
        )
      order by f.created_at desc, f.id desc
      limit 1
    ) followup on true
    left join lateral (
      select count(*)::int as count
      from public.contact_followups f
      where f.case_id = c.id
        and (
          f.report_id = r.id
          or (
            f.report_id is null
            and (
              (f.contact_id is not null and f.contact_id = rc.id)
              or (f.contact_id is null and r.id = initial_report.id)
            )
          )
        )
    ) followup_count on true
    -- Follow-up is an operational lifecycle independent from moderation:
    -- * without a follow-up, actionable pending/escalated reports enter;
    -- * any latest open follow-up remains after approval/rejection;
    -- * an explicit latest `cerrado` always removes the item, even while the
    --   report itself is still pending/escalated.
    where coalesce(followup.contact_status <> 'cerrado', true)
      and (
        followup.contact_status is not null
        or (
          r.moderation_status in ('pending', 'escalated')
          and (
            r.report_type in ('sighting', 'possible_trapped', 'possible_deceased')
            or rc.id is not null
            or c.publication_status = 'pending_review'
          )
        )
      )
  ) queue;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (
    v_actor,
    'contact_followup_queue_accessed',
    'contact_queue',
    jsonb_build_object(
      'reportCount', coalesce(cardinality(v_report_ids), 0),
      'reportIds', to_jsonb(v_report_ids)
    )
  );

  return v_result;
end;
$$;

revoke all on function public.get_contact_followup_queue() from public, anon;
grant execute on function public.get_contact_followup_queue() to authenticated;

create or replace function public.log_contact_followup(
  p_case_id uuid,
  p_report_id uuid,
  p_contact_id uuid,
  p_target_type text,
  p_contact_method text,
  p_contact_status text,
  p_summary_private text,
  p_next_followup_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_followup_id uuid;
  v_created_at timestamptz;
begin
  if v_actor is null or not public.is_moderator_or_admin() then
    raise exception using errcode = '42501', message = 'Moderator or admin access required';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id) then
    raise exception using errcode = 'P0002', message = 'Case not found';
  end if;
  if p_report_id is not null and not exists (
    select 1 from public.case_reports where id = p_report_id and case_id = p_case_id
  ) then
    raise exception using errcode = '22023', message = 'Report does not belong to case';
  end if;
  if p_contact_id is not null and not exists (
    select 1
    from public.reporter_contacts rc
    join public.case_reports r on r.id = rc.report_id
    where rc.id = p_contact_id
      and r.case_id = p_case_id
      and (p_report_id is null or rc.report_id = p_report_id)
  ) then
    raise exception using errcode = '22023', message = 'Contact does not belong to case or report';
  end if;
  if p_target_type not in ('reportante_inicial', 'informante', 'familia', 'otro') then
    raise exception using errcode = '22023', message = 'Invalid contact target type';
  end if;
  if p_contact_method not in ('llamada', 'whatsapp', 'sms', 'correo', 'presencial', 'otro') then
    raise exception using errcode = '22023', message = 'Invalid contact method';
  end if;
  if p_contact_status not in (
    'pendiente', 'contactado', 'no_respondio', 'numero_errado',
    'requiere_seguimiento', 'cerrado'
  ) then
    raise exception using errcode = '22023', message = 'Invalid contact status';
  end if;
  if nullif(btrim(p_summary_private), '') is null
    or char_length(btrim(p_summary_private)) < 3
    or char_length(btrim(p_summary_private)) > 2000 then
    raise exception using errcode = '22023', message = 'A private contact summary between 3 and 2000 characters is required';
  end if;
  if p_contact_status = 'requiere_seguimiento' and p_next_followup_at is null then
    raise exception using errcode = '22023', message = 'A next follow-up date is required';
  end if;

  insert into public.contact_followups (
    case_id, report_id, contact_id, target_type, contact_method,
    contact_status, summary_private, next_followup_at, created_by, created_at
  ) values (
    p_case_id, p_report_id, p_contact_id, p_target_type, p_contact_method,
    p_contact_status, btrim(p_summary_private), p_next_followup_at, v_actor,
    clock_timestamp()
  ) returning id, created_at into v_followup_id, v_created_at;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'contact_followup_logged',
    'contact_followup',
    v_followup_id,
    jsonb_strip_nulls(jsonb_build_object(
      'caseId', p_case_id,
      'reportId', p_report_id,
      'contactId', p_contact_id,
      'targetType', p_target_type,
      'contactMethod', p_contact_method,
      'contactStatus', p_contact_status,
      'nextFollowupAt', p_next_followup_at
    ))
  );

  return jsonb_build_object(
    'followupId', v_followup_id,
    'caseId', p_case_id,
    'reportId', p_report_id,
    'status', p_contact_status,
    'createdAt', v_created_at
  );
end;
$$;

revoke all on function public.log_contact_followup(uuid,uuid,uuid,text,text,text,text,timestamptz) from public, anon;
grant execute on function public.log_contact_followup(uuid,uuid,uuid,text,text,text,text,timestamptz) to authenticated;

create or replace function public.get_staff_media_asset(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_asset public.media_assets%rowtype;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;
  if p_asset_id is null then
    raise exception using errcode = '22023', message = 'Asset id is required';
  end if;

  select * into v_asset
  from public.media_assets
  where id = p_asset_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Media asset not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'staff_media_asset_accessed',
    'media_asset',
    p_asset_id,
    jsonb_build_object(
      'caseId', v_asset.case_id,
      'reportId', v_asset.report_id,
      'storageBucket', v_asset.storage_bucket,
      'isPrivateEvidence', v_asset.storage_bucket = 'report-evidence'
    )
  );

  return jsonb_build_object(
    'id', v_asset.id,
    'caseId', v_asset.case_id,
    'reportId', v_asset.report_id,
    'assetType', v_asset.asset_type,
    'storageBucket', v_asset.storage_bucket,
    'privatePath', v_asset.private_path,
    'publicPath', v_asset.public_path,
    'originalFilename', v_asset.original_filename,
    'detectedMimeType', v_asset.detected_mime_type,
    'sizeBytes', v_asset.size_bytes,
    'createdAt', v_asset.created_at
  );
end;
$$;

revoke all on function public.get_staff_media_asset(uuid) from public, anon;
grant execute on function public.get_staff_media_asset(uuid) to authenticated;

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
  v_authority_reference text;
  v_description text;
  v_location text;
  v_age_text text;
  v_age integer;
  v_name_matches integer;
  v_case_id uuid;
  v_batch_name_matches integer;
  v_batch_reference_matches integer;
  v_reference_matches integer;
  v_reference_case_id uuid;
  v_reference_person_name text;
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
    if public.public_text_contains_contact_information(v_name)
      or public.public_text_contains_contact_information(v_description)
      or public.public_text_contains_contact_information(v_location) then
      raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': public fields cannot contain phone numbers or email addresses';
    end if;

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

    if nullif(btrim(v_item.value ->> 'date_confirmed'), '') is not null then
      if btrim(v_item.value ->> 'date_confirmed') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': date_confirmed must use YYYY-MM-DD';
      end if;
      begin
        perform (v_item.value ->> 'date_confirmed')::date;
      exception when others then
        raise exception using errcode = '22023', message = 'Row ' || v_item.ordinality || ': date_confirmed must use YYYY-MM-DD';
      end;
    end if;

    v_normalized := public.normalize_person_name(v_name);
    v_authority_reference := 'Medicina Legal — ' || v_reference;

    select count(*) into v_batch_name_matches
    from jsonb_array_elements(p_rows) batch_row
    where public.normalize_person_name(nullif(btrim(batch_row ->> 'full_name'), '')) = v_normalized;

    select count(*) into v_batch_reference_matches
    from jsonb_array_elements(p_rows) batch_row
    where lower(nullif(btrim(batch_row ->> 'source_reference'), '')) = lower(v_reference);

    select count(*), min(c.id::text)::uuid
    into v_name_matches, v_case_id
    from public.people p
    left join public.cases c on c.person_id = p.id
    where p.normalized_name = v_normalized;

    select count(*), min(c.id::text)::uuid, min(p.normalized_name)
    into v_reference_matches, v_reference_case_id, v_reference_person_name
    from public.cases c
    join public.people p on p.id = c.person_id
    where lower(btrim(c.authority_reference_private)) = lower(v_authority_reference);

    v_review_reason := null;
    if v_batch_name_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'duplicate_normalized_name_in_file';
    elsif v_batch_reference_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'duplicate_source_reference_in_file';
    elsif v_name_matches > 1 or v_reference_matches > 1 then
      v_decision := 'review_required';
      v_review_reason := 'ambiguous_existing_match';
    elsif v_reference_matches = 1 and v_reference_person_name <> v_normalized then
      v_decision := 'review_required';
      v_review_reason := 'source_reference_used_by_another_person';
    elsif v_reference_matches = 1 and v_reference_person_name = v_normalized then
      v_decision := 'already_imported';
      v_case_id := v_reference_case_id;
    elsif v_name_matches = 0 then
      v_decision := 'create';
    else
      v_decision := 'update';
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'row', v_item.ordinality,
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
  v_authority_reference text;
  v_description text;
  v_location text;
  v_age integer;
  v_confirmed_at timestamptz;
  v_match_count integer;
  v_person_id uuid;
  v_case public.cases%rowtype;
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

  -- Preview performs the complete validation and conflict classification before
  -- any person/case mutation occurs. File-level duplicates block atomically.
  v_preview := public.preview_official_deceased_import(p_rows);
  if exists (
    select 1
    from jsonb_array_elements(v_preview) item
    where item ->> 'decision' = 'review_required'
  ) then
    raise exception using errcode = 'P0003', message = 'Import contains rows that require manual review';
  end if;

  -- Serialize imports by both normalized name and source reference. This
  -- closes races where concurrent admins could otherwise create duplicates.
  for v_normalized in
    select distinct public.normalize_person_name(item ->> 'full_name')
    from jsonb_array_elements(p_rows) item
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('official-person:' || v_normalized, 0));
  end loop;

  for v_reference in
    select distinct lower(btrim(item ->> 'source_reference'))
    from jsonb_array_elements(p_rows) item
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('medicina-legal:' || v_reference, 0));
  end loop;

  -- Re-evaluate after acquiring locks because another transaction may have
  -- committed while this import was waiting.
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
    if public.public_text_contains_contact_information(v_description)
      or public.public_text_contains_contact_information(v_location) then
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
    if nullif(btrim(v_row ->> 'date_confirmed'), '') is not null then
      v_confirmed_at := (((v_row ->> 'date_confirmed')::date + time '12:00') at time zone 'America/Bogota');
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
        full_name, approximate_age, is_minor, public_description, is_test_data
      ) values (
        v_name, v_age, coalesce(v_age < 18, false), v_description, false
      ) returning id into v_person_id;
      v_created := v_created + 1;
    else
      update public.people
      set approximate_age = coalesce(v_age, approximate_age),
          is_minor = case when v_age is null then is_minor else v_age < 18 end,
          public_description = coalesce(v_description, public_description),
          updated_at = now()
      where id = v_person_id;
      v_updated := v_updated + 1;
    end if;

    v_authority_reference := 'Medicina Legal — ' || v_reference;
    select * into v_case
    from public.cases
    where person_id = v_person_id
    for update;

    if not found then
      insert into public.cases (
        person_id, slug, publication_status, condition_status, verification_level,
        urgency_level, last_seen_location_public, authority_reference_private,
        resolution_notes_private, resolved_at, published_at,
        primary_public_photo_path, public_source_label
      ) values (
        v_person_id,
        v_normalized || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
        'published', 'deceased_confirmed', 'authority_confirmed', 'normal',
        v_location, v_authority_reference, btrim(p_reason), v_confirmed_at,
        now(), null, 'Medicina Legal'
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
          public_source_label = 'Medicina Legal',
          resolution_notes_private = btrim(p_reason),
          resolved_at = coalesce(v_confirmed_at, resolved_at),
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
      elsif not exists (
        select 1
        from public.status_history h
        where h.case_id = v_case_id
          and h.previous_condition = v_case.condition_status
          and h.new_condition = 'deceased_confirmed'
          and h.new_verification = 'authority_confirmed'
          and h.actor_id = v_actor
          and h.created_at >= transaction_timestamp()
      ) then
        -- case_safety_trigger must audit every transition. Fail the complete
        -- import atomically if that invariant is ever broken or removed.
        raise exception using errcode = 'P0004', message = 'Death status transition history was not recorded';
      end if;
    end if;

    insert into public.moderation_actions (
      case_id, actor_id, action, reason, metadata
    ) values (
      v_case_id, v_actor, 'official_deceased_import', btrim(p_reason),
      jsonb_build_object(
        'official', true,
        'sourceName', 'Medicina Legal',
        'sourceReferencePresent', true
      )
    );

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      v_actor, 'official_deceased_imported', 'case', v_case_id,
      jsonb_build_object(
        'official', true,
        'sourceName', 'Medicina Legal',
        'sourceReferencePresent', true
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

-- A service-role bootstrap is permitted exactly once. It does not create an
-- Auth identity: the target must already exist in auth.users. A transaction
-- advisory lock serializes bootstrap and later role changes so two concurrent
-- requests cannot create two "first" administrators or remove the last one.
create or replace function public.bootstrap_initial_admin(
  p_user_id uuid,
  p_display_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required for initial admin bootstrap';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '23503', message = 'Target Auth user does not exist';
  end if;
  if char_length(v_display_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Display name must contain between 2 and 120 characters';
  end if;
  if char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'Bootstrap reason must contain between 10 and 1000 characters';
  end if;

  perform pg_advisory_xact_lock(824628171, 20260813);

  if exists (select 1 from public.profiles where role = 'admin')
    or exists (select 1 from public.audit_logs where action = 'initial_admin_bootstrapped') then
    raise exception using errcode = '55000', message = 'Initial admin bootstrap was already completed; use manage_staff_profile';
  end if;

  insert into public.profiles (id, display_name, role, active, updated_at)
  values (p_user_id, v_display_name, 'admin', true, now())
  on conflict (id) do update
  set display_name = excluded.display_name,
      role = 'admin',
      active = true,
      updated_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    'initial_admin_bootstrapped',
    'profile',
    p_user_id,
    jsonb_build_object(
      'actorType', 'service_role',
      'reason', v_reason,
      'newRole', 'admin',
      'newActive', true
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'role', 'admin',
    'active', true,
    'bootstrapped', true
  );
end;
$$;

revoke all on function public.bootstrap_initial_admin(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_initial_admin(uuid,text,text) to service_role;

-- Once the initial administrator exists, every staff assignment is authorized
-- by an active admin session. Direct profile writes remain revoked. The audit
-- metadata intentionally contains roles, state and reason but no email, token,
-- password or other Auth credential.
create or replace function public.manage_staff_profile(
  p_user_id uuid,
  p_display_name text,
  p_role public.app_role,
  p_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_previous public.profiles%rowtype;
begin
  perform pg_advisory_xact_lock(824628171, 20260813);

  if v_actor is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'An active admin session is required';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '23503', message = 'Target Auth user does not exist';
  end if;
  if p_role is null or p_role not in ('admin', 'moderator', 'responder') then
    raise exception using errcode = '22023', message = 'Staff role must be admin, moderator or responder';
  end if;
  if p_active is null then
    raise exception using errcode = '22023', message = 'Active state is required';
  end if;
  if char_length(v_display_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Display name must contain between 2 and 120 characters';
  end if;
  if char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'Staff-change reason must contain between 10 and 1000 characters';
  end if;

  select * into v_previous
  from public.profiles
  where id = p_user_id
  for update;

  if found
    and v_previous.role = 'admin'
    and v_previous.active
    and (p_role <> 'admin' or not p_active)
    and not exists (
      select 1 from public.profiles
      where id <> p_user_id and role = 'admin' and active
    ) then
    raise exception using errcode = '55000', message = 'The last active admin cannot be demoted or deactivated';
  end if;

  insert into public.profiles (id, display_name, role, active, updated_at)
  values (p_user_id, v_display_name, p_role, p_active, now())
  on conflict (id) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      active = excluded.active,
      updated_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor,
    'staff_profile_managed',
    'profile',
    p_user_id,
    jsonb_build_object(
      'reason', v_reason,
      'previousProfileExists', v_previous.id is not null,
      'previousRole', case when v_previous.id is null then null else v_previous.role::text end,
      'previousActive', case when v_previous.id is null then null else v_previous.active end,
      'newRole', p_role::text,
      'newActive', p_active
    )
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'role', p_role::text,
    'active', p_active,
    'updated', v_previous.id is not null
  );
end;
$$;

revoke all on function public.manage_staff_profile(uuid,text,public.app_role,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_staff_profile(uuid,text,public.app_role,boolean,text)
  to authenticated;

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
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
      into v_last_migration;
  end if;

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
    'schemaVersion', '202608130001',
    'lastMigrationApplied', v_last_migration,
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
        'contact_followups', 'status_history', 'audit_logs', 'public_case_cards'
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
