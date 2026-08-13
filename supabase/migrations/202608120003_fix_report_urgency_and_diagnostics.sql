-- Fix enum assignment in both report branches and retain full server-side
-- diagnostics for every database step. No public role receives new access.

create or replace function public.submit_public_report(p_payload jsonb)
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
  v_error_detail text;
  v_error_hint text;
  v_error_context text;
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
  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'query', 'insert into public.submission_rate_limits ... on conflict ... do update'
  );
  insert into public.submission_rate_limits as limits (
    request_fingerprint,
    window_started_at,
    submission_count,
    updated_at
  ) values (
    v_request_fingerprint,
    v_now,
    1,
    v_now
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
  raise log '[REPORTS] %', jsonb_build_object('step', 'Submission rate limit updated');

  if v_submission_count > 5 then
    raise exception using errcode = 'P0001', message = 'Submission rate limit reached';
  end if;

  v_step := 'Validating report kind';
  v_kind := nullif(btrim(p_payload ->> 'kind'), '');
  if v_kind is null or v_kind not in ('missing_person', 'case_information') then
    raise exception using errcode = '22023', message = 'Invalid report kind';
  end if;

  if v_kind = 'case_information' then
    v_case_reference := nullif(btrim(p_payload ->> 'caseId'), '');
    if v_case_reference is null then
      raise exception using errcode = '22023', message = 'A case reference is required';
    end if;

    if v_case_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_step := 'Finding public case';
      raise log '[REPORTS] %', jsonb_build_object(
        'step', v_step,
        'query', 'select id from public.cases where id = $1 and publication_status = published and deleted_at is null'
      );
      select c.id
      into v_case_id
      from public.cases c
      where c.id = v_case_reference::uuid
        and c.publication_status = 'published'
        and c.deleted_at is null
      for key share;
      raise log '[REPORTS] %', jsonb_build_object('step', 'Public case lookup completed', 'found', v_case_id is not null);
    else
      raise exception using errcode = '22023', message = 'Invalid case reference';
    end if;

    if v_case_id is null then
      raise exception using errcode = 'P0002', message = 'Case is not available for public reports';
    end if;

    v_report_type_text := nullif(btrim(p_payload ->> 'reportType'), '');
    if v_report_type_text is null or v_report_type_text not in ('sighting', 'possible_trapped', 'possible_deceased', 'correction', 'other_information') then
      raise exception using errcode = '22023', message = 'Invalid report type';
    end if;
    v_report_type := v_report_type_text::public.report_type;

    v_location := nullif(btrim(p_payload ->> 'location'), '');
    if v_location is not null and char_length(v_location) > 240 then
      raise exception using errcode = '22023', message = 'Location is too long';
    end if;

    v_description := nullif(btrim(p_payload ->> 'description'), '');
    if v_description is null or char_length(v_description) < 10 or char_length(v_description) > 3000 then
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
    raise log '[REPORTS] %', jsonb_build_object(
      'step', v_step,
      'query', 'insert into public.case_reports (... urgency_level ...) values (... public.urgency_level ...) returning id, tracking_code'
    );
    insert into public.case_reports (
      case_id,
      report_type,
      event_at,
      location_private,
      location_public,
      description,
      urgency_level,
      is_sensitive
    ) values (
      v_case_id,
      v_report_type,
      v_event_at,
      v_location,
      null,
      v_description,
      case when v_report_type = 'possible_trapped'
        then 'urgent'::public.urgency_level
        else 'normal'::public.urgency_level
      end,
      true
    ) returning id, tracking_code into v_report_id, v_tracking_code;
    raise log '[REPORTS] %', jsonb_build_object('step', 'Report created');
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
  if v_reporter_name is null or char_length(v_reporter_name) < 2 or char_length(v_reporter_name) > 140 then
    raise exception using errcode = '22023', message = 'Reporter name must be between 2 and 140 characters';
  end if;

  v_phone := nullif(btrim(p_payload ->> 'phone'), '');
  if v_phone is not null and (char_length(v_phone) < 7 or char_length(v_phone) > 40 or v_phone !~ '^[0-9+ ()-]+$') then
    raise exception using errcode = '22023', message = 'Invalid phone number';
  end if;

  v_email := nullif(btrim(p_payload ->> 'email'), '');
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
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
  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'query', 'insert into public.people (...) values (...) returning id'
  );
  insert into public.people (
    full_name,
    aliases,
    approximate_age,
    is_minor,
    distinguishing_features,
    private_notes
  ) values (
    v_full_name,
    case when v_alias is null then '{}'::text[] else array[v_alias] end,
    v_age,
    v_is_minor,
    v_features,
    v_circumstances
  ) returning id into v_person_id;
  raise log '[REPORTS] %', jsonb_build_object('step', 'Person created');

  v_step := 'Creating case';
  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'query', 'insert into public.cases (... urgency_level ...) values (... public.urgency_level ...) returning id'
  );
  insert into public.cases (
    person_id,
    slug,
    publication_status,
    condition_status,
    last_seen_at,
    last_seen_location_public,
    last_seen_location_private,
    clothing,
    circumstances_public,
    circumstances_private,
    urgency_level
  ) values (
    v_person_id,
    v_normalized_name || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'pending_review',
    'missing',
    v_last_seen_at,
    null,
    v_location,
    v_clothing,
    null,
    v_circumstances,
    case when v_is_minor
      then 'priority'::public.urgency_level
      else 'normal'::public.urgency_level
    end
  ) returning id into v_case_id;
  raise log '[REPORTS] %', jsonb_build_object('step', 'Case created');

  v_step := 'Creating report';
  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'query', 'insert into public.case_reports (...) values (...) returning id, tracking_code'
  );
  insert into public.case_reports (
    case_id,
    report_type,
    description,
    is_sensitive
  ) values (
    v_case_id,
    'other_information',
    'Initial family report',
    true
  ) returning id, tracking_code into v_report_id, v_tracking_code;
  raise log '[REPORTS] %', jsonb_build_object('step', 'Report created');

  v_step := 'Creating reporter contact';
  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'query', 'insert into public.reporter_contacts (...) values (...)'
  );
  insert into public.reporter_contacts (
    report_id,
    reporter_name,
    phone,
    email,
    preferred_contact_method
  ) values (
    v_report_id,
    v_reporter_name,
    v_phone,
    v_email,
    v_preferred_contact
  );
  raise log '[REPORTS] %', jsonb_build_object('step', 'Reporter contact created');
  raise log '[REPORTS] %', jsonb_build_object('step', 'Finished successfully');

  return jsonb_build_object('tracking_code', v_tracking_code);
exception when others then
  get stacked diagnostics
    v_error_code = returned_sqlstate,
    v_error_message = message_text,
    v_error_detail = pg_exception_detail,
    v_error_hint = pg_exception_hint,
    v_error_context = pg_exception_context,
    v_error_constraint = constraint_name,
    v_error_table = table_name,
    v_error_column = column_name,
    v_error_schema = schema_name,
    v_error_datatype = pg_datatype_name;

  raise log '[REPORTS] %', jsonb_build_object(
    'step', v_step,
    'error', jsonb_build_object(
      'code', v_error_code,
      'message', v_error_message,
      'details', v_error_detail,
      'hint', v_error_hint,
      'constraint', v_error_constraint,
      'table', v_error_table,
      'column', v_error_column,
      'schema', v_error_schema,
      'datatype', v_error_datatype,
      'context', v_error_context
    )
  );

  raise exception using
    errcode = v_error_code,
    message = v_error_message,
    detail = jsonb_build_object(
      'reportStep', v_step,
      'postgresDetails', v_error_detail,
      'constraint', v_error_constraint,
      'table', v_error_table,
      'column', v_error_column,
      'schema', v_error_schema,
      'datatype', v_error_datatype,
      'context', v_error_context
    )::text,
    hint = coalesce(nullif(v_error_hint, ''), 'Use reportStep and context to locate the failing SQL statement');
end;
$$;

revoke all on function public.submit_public_report(jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_report(jsonb) to service_role;

-- Server-only metadata used by GET /api/debug/reports. It returns schema
-- metadata only: never table rows, contacts, locations, paths, or secrets.
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
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
      into v_last_migration;
  end if;

  return jsonb_build_object(
    'schemaVersion', '202608120003',
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
        'people',
        'cases',
        'case_reports',
        'reporter_contacts',
        'submission_rate_limits',
        'media_assets',
        'public_case_cards'
      ]) expected(name)
      left join pg_namespace namespace on namespace.nspname = 'public'
      left join pg_class relation on relation.relnamespace = namespace.oid and relation.relname = expected.name
    ),
    'rpcs', jsonb_build_array(
      jsonb_build_object('name', 'submit_public_report', 'found', to_regprocedure('public.submit_public_report(jsonb)') is not null),
      jsonb_build_object('name', 'get_public_case', 'found', to_regprocedure('public.get_public_case(text)') is not null),
      jsonb_build_object('name', 'search_public_people', 'found', to_regprocedure('public.search_public_people(text,text,integer,integer,integer,integer)') is not null)
    )
  );
end;
$$;

revoke all on function public.reports_debug_snapshot() from public, anon, authenticated;
grant execute on function public.reports_debug_snapshot() to service_role;

notify pgrst, 'reload schema';
