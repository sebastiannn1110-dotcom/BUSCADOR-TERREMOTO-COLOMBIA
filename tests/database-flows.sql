\set ON_ERROR_STOP on

begin;
set local app.enable_test_data = 'true';

do $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_result jsonb;
  v_case_id uuid;
  v_report_id uuid;
  v_tracking text;
  v_count integer;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values (v_admin, 'admin-ficticio@example.invalid', now(), now());
  insert into public.profiles (id, display_name, role, active)
  values (v_admin, 'Administrador ficticio', 'admin', true);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'missing_person',
    'fullName', 'Persona Ficticia Flujo SQL',
    'approximateAge', 30,
    'isMinor', false,
    'lastSeenAt', '2026-08-12T08:00:00-05:00',
    'location', 'Lugar ficticio aproximado',
    'circumstances', 'Situación completamente ficticia para validar la transacción local.',
    'reporterName', 'Reportante ficticio',
    'phone', '3000000000',
    'preferredContact', 'phone',
    'requestFingerprint', repeat('a', 64)
  ));
  v_tracking := v_result ->> 'tracking_code';
  select r.id, r.case_id into v_report_id, v_case_id from public.case_reports r where r.tracking_code = v_tracking;
  if v_report_id is null then raise exception 'Missing-person report did not persist'; end if;
  if (select publication_status from public.cases where id = v_case_id) <> 'pending_review' then raise exception 'New case was published unexpectedly'; end if;
  if (select moderation_status from public.case_reports where id = v_report_id) <> 'pending' then raise exception 'New report was not pending'; end if;

  v_result := public.import_official_deceased(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Oficial SQL',
    'approximate_age', '41',
    'gender', '',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia ficticia de integración',
    'public_description', 'Registro ficticio usado solo dentro de una transacción con rollback.',
    'last_seen_location_public', 'Lugar ficticio',
    'date_confirmed', '2026-08-12'
  )), 'Prueba local explícita y reversible del importador oficial');
  if (v_result ->> 'created')::integer <> 1 then raise exception 'Official import did not create one case'; end if;

  select c.id into v_case_id
  from public.cases c join public.people p on p.id = c.person_id
  where p.full_name = 'Persona Ficticia Oficial SQL';
  if not exists (
    select 1 from public.cases where id = v_case_id
      and condition_status = 'deceased_confirmed'
      and verification_level = 'authority_confirmed'
      and publication_status = 'published'
      and urgency_level = 'normal'
      and primary_public_photo_path is null
  ) then raise exception 'Official case flags are incorrect'; end if;
  if not exists (select 1 from public.status_history where case_id = v_case_id) then raise exception 'Status history missing'; end if;
  if not exists (select 1 from public.audit_logs where entity_id = v_case_id and action = 'official_deceased_imported') then raise exception 'Audit log missing'; end if;
  if not exists (select 1 from public.moderation_actions where case_id = v_case_id and action = 'official_deceased_import') then raise exception 'Moderation action missing'; end if;

  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'case_information',
    'caseId', v_case_id,
    'reportType', 'sighting',
    'eventAt', '2026-08-12T09:00:00-05:00',
    'location', 'Dirección privada ficticia',
    'description', 'Descripción privada ficticia de un avistamiento pendiente.',
    'requestFingerprint', repeat('b', 64)
  ));
  v_tracking := v_result ->> 'tracking_code';
  select id into v_report_id from public.case_reports where tracking_code = v_tracking;
  select approved_reports_count into v_count from public.public_case_cards where id = v_case_id;
  if v_count <> 0 then raise exception 'Pending sighting leaked into public count'; end if;

  perform public.moderate_case_report(
    v_report_id,
    'approved',
    'Prueba ficticia de aprobación moderada',
    'Sector público aproximado',
    'Descripción pública ficticia revisada por moderación.'
  );
  select approved_reports_count into v_count from public.public_case_cards where id = v_case_id;
  if v_count <> 1 then raise exception 'Approved sighting did not reach public count'; end if;
  if (select condition_status from public.cases where id = v_case_id) <> 'deceased_confirmed' then raise exception 'Moderation changed the case status'; end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_case_cards'
      and column_name in ('phone','email','reporter_name','location_private','authority_reference_private')
  ) then raise exception 'Private columns leaked into public projection'; end if;
end;
$$;

rollback;

select 'database integration flows passed' as result;
