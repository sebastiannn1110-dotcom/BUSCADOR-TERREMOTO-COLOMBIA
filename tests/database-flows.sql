\set ON_ERROR_STOP on

begin;
set local app.enable_test_data = 'true';

do $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_moderator uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_responder uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_staff uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_result jsonb;
  v_queue jsonb;
  v_public jsonb;
  v_case_id uuid;
  v_existing_case_id uuid;
  v_existing_person_id uuid;
  v_report_id uuid;
  v_contact_id uuid;
  v_initial_report_id uuid;
  v_initial_contact_id uuid;
  v_second_sighting_report_id uuid;
  v_second_sighting_contact_id uuid;
  v_asset_id uuid;
  v_tracking text;
  v_slug text;
  v_official_case_id uuid;
  v_sensitive_report_id uuid;
  v_sensitive_contact_id uuid;
  v_trapped_report_id uuid;
  v_trapped_contact_id uuid;
  v_failed boolean;
  v_count integer;
  v_count_before integer;
  v_withdraw_case_id uuid;
  v_withdraw_person_id uuid;
begin
  insert into auth.users (id, email, created_at, updated_at)
  values
    (v_admin, 'admin-ficticio@example.invalid', now(), now()),
    (v_moderator, 'moderador-ficticio@example.invalid', now(), now()),
    (v_responder, 'respuesta-ficticia@example.invalid', now(), now()),
    (v_staff, 'staff-ficticio@example.invalid', now(), now());

  -- The first admin can only be bootstrapped by service_role, for an existing
  -- Auth user and with an auditable reason. It cannot be replayed.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_failed := false;
  begin
    perform public.bootstrap_initial_admin(
      v_admin,
      'Administrador ficticio',
      'Bootstrap ficticio sin privilegio de service role'
    );
  exception when sqlstate '42501' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Authenticated caller bootstrapped the first admin';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  begin
    perform public.bootstrap_initial_admin(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'Usuario inexistente',
      'Validación ficticia de usuario Auth inexistente'
    );
  exception when sqlstate '23503' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Initial admin bootstrap accepted a nonexistent Auth user';
  end if;

  v_failed := false;
  begin
    perform public.bootstrap_initial_admin(v_admin, 'Administrador ficticio', 'corta');
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Initial admin bootstrap accepted a short reason';
  end if;

  v_result := public.bootstrap_initial_admin(
    v_admin,
    'Administrador ficticio',
    'Creación ficticia controlada del primer administrador'
  );
  if v_result ->> 'userId' <> v_admin::text
    or v_result ->> 'role' <> 'admin'
    or not (v_result ->> 'active')::boolean
    or not exists (
      select 1 from public.profiles
      where id = v_admin and role = 'admin' and active
    ) then
    raise exception 'Initial admin bootstrap did not create the expected profile';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where actor_id is null
      and action = 'initial_admin_bootstrapped'
      and entity_type = 'profile'
      and entity_id = v_admin
      and metadata ->> 'actorType' = 'service_role'
      and metadata ->> 'reason' = 'Creación ficticia controlada del primer administrador'
      and metadata ? 'newRole'
      and not (metadata ? 'email')
      and not (metadata ? 'token')
  ) then
    raise exception 'Initial admin bootstrap audit event is incomplete or unsafe';
  end if;

  v_failed := false;
  begin
    perform public.bootstrap_initial_admin(
      v_staff,
      'Segundo administrador ficticio',
      'Intento ficticio de repetir el bootstrap administrativo'
    );
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Initial admin bootstrap was replayed after an active admin existed';
  end if;

  -- Defense in depth: even an out-of-band deactivation must not reopen the
  -- one-time bootstrap because the audit marker remains immutable history.
  update public.profiles set active = false where id = v_admin;
  v_failed := false;
  begin
    perform public.bootstrap_initial_admin(
      v_staff,
      'Segundo administrador ficticio',
      'Intento ficticio posterior a una desactivación fuera del flujo'
    );
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  update public.profiles set active = true where id = v_admin;
  if not v_failed then
    raise exception 'Historical bootstrap marker did not block reuse after deactivation';
  end if;

  insert into public.profiles (id, display_name, role, active)
  values
    (v_moderator, 'Moderador ficticio', 'moderator', true),
    (v_responder, 'Respondiente ficticio', 'responder', true);

  -- Every later staff change requires an authenticated active admin, preserves
  -- the last administrator and records only non-secret operational metadata.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_moderator::text, true);
  v_failed := false;
  begin
    perform public.manage_staff_profile(
      v_staff, 'Staff ficticio', 'moderator', true,
      'Intento ficticio ejecutado por un moderador'
    );
  exception when sqlstate '42501' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Moderator managed a staff profile';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := public.manage_staff_profile(
    v_staff,
    'Staff ficticio',
    'moderator',
    true,
    'Asignación ficticia aprobada para tareas de moderación'
  );
  if v_result ->> 'userId' <> v_staff::text
    or v_result ->> 'role' <> 'moderator'
    or not exists (
      select 1 from public.profiles
      where id = v_staff and role = 'moderator' and active
    ) then
    raise exception 'Admin did not create the expected staff profile';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where actor_id = v_admin
      and action = 'staff_profile_managed'
      and entity_type = 'profile'
      and entity_id = v_staff
      and metadata ->> 'newRole' = 'moderator'
      and metadata ->> 'reason' = 'Asignación ficticia aprobada para tareas de moderación'
      and not (metadata ? 'email')
      and not (metadata ? 'token')
  ) then
    raise exception 'Staff management audit event is incomplete or unsafe';
  end if;

  v_failed := false;
  begin
    perform public.manage_staff_profile(
      v_admin,
      'Administrador ficticio',
      'moderator',
      true,
      'Intento ficticio de degradar al último administrador'
    );
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed or not exists (
    select 1 from public.profiles where id = v_admin and role = 'admin' and active
  ) then
    raise exception 'Last active admin protection failed';
  end if;

  v_failed := false;
  begin
    perform public.manage_staff_profile(
      v_staff,
      'Staff ficticio',
      'public',
      true,
      'Intento ficticio de asignar un rol que no es de staff'
    );
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Staff management accepted a non-staff role';
  end if;

  if public.public_text_contains_contact_information('Confirmado el 12/08/2026')
    or not public.public_text_contains_contact_information('Contacto +57 (300) 123-4567')
    or not public.public_text_contains_contact_information('correo.ficticio@example.invalid') then
    raise exception 'Public contact-information detector has false date/phone/email behavior';
  end if;
  if lower(pg_get_functiondef('public.submit_public_report_core(jsonb)'::regprocedure))
      like '%pg_exception_detail%'
    or lower(pg_get_functiondef('public.submit_public_report_core(jsonb)'::regprocedure))
      like '%pg_exception_context%'
    or lower(pg_get_functiondef('public.submit_public_report_core(jsonb)'::regprocedure))
      like '%postgresdetails%'
    or exists (
      select 1
      from regexp_matches(
        pg_get_functiondef('public.submit_public_report_core(jsonb)'::regprocedure),
        'raise[[:space:]]+log[^;]*;',
        'gi'
      ) logged
      where logged[1] ~* '(p_payload|v_phone|v_email|v_location|v_description|v_reporter_name|v_full_name|v_error_detail|v_error_context)'
    ) then
    raise exception 'Final report core contains unsafe exception diagnostics or logs';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- The backend derives minor protection from age even if the client sends a
  -- contradictory boolean. The initial report remains private and pending.
  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'missing_person',
    'fullName', 'Persona Ficticia Pendiente SQL',
    'approximateAge', 16,
    'isMinor', false,
    'lastSeenAt', '2026-08-12T08:00:00-05:00',
    'location', 'Dirección privada ficticia de prueba',
    'features', 'Chaqueta azul y cicatriz ficticia para identificación.',
    'circumstances', null,
    'reporterName', 'Reportante Ficticio',
    'phone', '3000000000',
    'preferredContact', 'phone',
    'consentAt', '2026-08-12T08:05:00-05:00',
    'requestFingerprint', repeat('a', 64)
  ));
  v_tracking := v_result ->> 'tracking_code';

  select r.id, r.case_id, c.slug
  into v_report_id, v_case_id, v_slug
  from public.case_reports r
  join public.cases c on c.id = r.case_id
  where r.tracking_code = v_tracking;

  v_initial_report_id := v_report_id;
  select id into v_initial_contact_id
  from public.reporter_contacts
  where report_id = v_initial_report_id;

  if v_report_id is null then
    raise exception 'Missing-person report did not persist';
  end if;
  if (select publication_status from public.cases where id = v_case_id) <> 'pending_review' then
    raise exception 'New case was published unexpectedly';
  end if;
  if (select is_minor from public.people p join public.cases c on c.person_id = p.id where c.id = v_case_id) <> true then
    raise exception 'Minor protection was not derived from age';
  end if;
  if (select description from public.case_reports where id = v_report_id) <> 'Reporte inicial de persona desaparecida' then
    raise exception 'Initial report description was not localized';
  end if;
  if exists (select 1 from public.public_case_cards where id = v_case_id) then
    raise exception 'Pending case leaked into public cards';
  end if;

  v_queue := public.get_pending_people_cases();
  if jsonb_array_length(v_queue) <> 1
    or v_queue #>> '{0,trackingCode}' <> v_tracking
    or v_queue #>> '{0,phone}' <> '3000000000'
    or v_queue #>> '{0,distinguishingFeatures}' is null then
    raise exception 'Pending people queue is incomplete';
  end if;
  if jsonb_array_length(public.get_pending_case_reports()) <> 0 then
    raise exception 'Initial pending-person report leaked into the information queue';
  end if;
  v_queue := public.get_contact_followup_queue();
  if not (v_queue @> jsonb_build_array(jsonb_build_object(
    'reportId', v_report_id,
    'descriptionPrivate', 'Reporte inicial de persona desaparecida',
    'lastFollowupStatus', null
  ))) then
    raise exception 'Initial pending-person report is absent from the contact queue';
  end if;
  if v_queue::text like '%Initial family report%' then
    raise exception 'Contact queue exposed the obsolete English initial-report description';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where actor_id = v_admin and action = 'pending_people_contacts_accessed'
  ) then
    raise exception 'Access to pending person contacts was not audited';
  end if;

  insert into public.media_assets (
    case_id, report_id, asset_type, storage_bucket, private_path,
    original_filename, detected_mime_type, size_bytes
  ) values (
    v_case_id, v_report_id, 'portrait', 'report-evidence',
    'reports/2026/11111111-1111-4111-8111-111111111111.jpg',
    'retrato-ficticio.jpg', 'image/jpeg', 1024
  ) returning id into v_asset_id;

  v_result := public.get_staff_media_asset(v_asset_id);
  if v_result ->> 'privatePath' <> 'reports/2026/11111111-1111-4111-8111-111111111111.jpg' then
    raise exception 'Authorized media lookup did not resolve private evidence';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where entity_id = v_asset_id and action = 'staff_media_asset_accessed'
  ) then
    raise exception 'Private media access was not audited';
  end if;

  perform set_config('request.jwt.claim.sub', v_moderator::text, true);
  v_failed := false;
  begin
    perform public.review_pending_person_case(
      v_case_id,
      'publish',
      'Validación adversarial de datos públicos.',
      'Escribir a familia-ficticia@example.invalid para más información.',
      'Sector público aproximado',
      null,
      null,
      null
    );
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed
    or (select publication_status from public.cases where id = v_case_id) <> 'pending_review' then
    raise exception 'Pending review accepted embedded public contact information';
  end if;

  v_result := public.review_pending_person_case(
    v_case_id,
    'publish',
    'Identidad y datos públicos ficticios revisados.',
    'Descripción pública ficticia revisada.',
    'Sector público aproximado',
    null,
    null,
    null
  );
  if not coalesce((v_result ->> 'published')::boolean, false) then
    raise exception 'Moderator did not publish pending person';
  end if;
  if not exists (
    select 1 from public.cases
    where id = v_case_id
      and publication_status = 'published'
      and condition_status = 'missing'
      and verification_level = 'moderator_reviewed'
      and authority_reference_private is null
      and primary_public_photo_path is null
  ) then
    raise exception 'Published missing-person flags are incorrect';
  end if;
  if not exists (
    select 1 from public.status_history
    where case_id = v_case_id
      and new_condition = 'missing'
      and new_verification = 'moderator_reviewed'
      and actor_id = v_moderator
  ) then
    raise exception 'Publication status history is missing';
  end if;
  if not exists (
    select 1 from public.moderation_actions
    where case_id = v_case_id and action = 'publish' and actor_id = v_moderator
  ) then
    raise exception 'Publication moderation action is missing';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where entity_id = v_case_id and action = 'pending_person_case_publish'
  ) then
    raise exception 'Publication audit event is missing';
  end if;

  select to_jsonb(card) into v_public
  from public.get_public_case(v_slug) card;
  if v_public is null
    or v_public ->> 'condition_status' <> 'missing'
    or v_public ->> 'last_seen_location_public' <> 'Sector público aproximado'
    or v_public ->> 'public_description' <> 'Descripción pública ficticia revisada.' then
    raise exception 'Published card is not returned by get_public_case';
  end if;
  if v_public::text like '%3000000000%'
    or v_public::text like '%Reportante Ficticio%'
    or v_public::text like '%Dirección privada ficticia%'
    or v_public::text like '%report-evidence%' then
    raise exception 'Private person-report data leaked through public RPC';
  end if;
  if not exists (
    select 1
    from public.search_public_people('', 'missing', null, null, 24, 0) card
    where card.id = v_case_id and card.slug = v_slug
  ) then
    raise exception 'Published missing person is absent from search_public_people';
  end if;

  -- A pending sighting is private; after moderation only the reviewed text and
  -- approximate location update both aliases in the public card contract.
  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'case_information',
    'caseId', v_case_id,
    'reportType', 'sighting',
    'reportContext', 'sighting_care',
    'eventAt', '2026-08-12T09:00:00-05:00',
    'location', 'Hospital privado ficticio, piso exacto',
    'description', 'Descripción privada ficticia de una atención reportada.',
    'reporterName', 'Informante Ficticio',
    'phone', '3111111111',
    'requestFingerprint', repeat('b', 64)
  ));
  select id into v_report_id
  from public.case_reports
  where tracking_code = v_result ->> 'tracking_code';
  select id into v_contact_id
  from public.reporter_contacts
  where report_id = v_report_id;

  if not exists (
    select 1 from public.case_reports
    where id = v_report_id
      and report_type = 'sighting'
      and report_context = 'sighting_care'
      and moderation_status = 'pending'
      and is_sensitive = true
  ) then
    raise exception 'Sighting context or private flags were not persisted';
  end if;
  select approved_sightings_count into v_count
  from public.public_case_cards where id = v_case_id;
  if v_count <> 0 then
    raise exception 'Pending sighting leaked into public count';
  end if;
  v_public := (select to_jsonb(card) from public.public_case_cards card where id = v_case_id);
  if v_public::text like '%Hospital privado ficticio%'
    or v_public::text like '%3111111111%'
    or v_public::text like '%Informante Ficticio%' then
    raise exception 'Pending sighting private data leaked publicly';
  end if;

  perform set_config('request.jwt.claim.sub', v_responder::text, true);
  v_failed := false;
  begin
    perform public.moderate_case_report(
      v_report_id,
      'approved',
      'Intento ficticio de un rol de solo lectura.',
      'Sector público aproximado',
      'Descripción pública ficticia suficientemente extensa.'
    );
  exception when sqlstate '42501' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Responder role was allowed to moderate a report';
  end if;
  v_queue := public.get_pending_case_reports();
  if not (v_queue @> jsonb_build_array(jsonb_build_object('id', v_report_id))) then
    raise exception 'Responder role lost its read-only moderation queue access';
  end if;

  perform set_config('request.jwt.claim.sub', v_moderator::text, true);
  v_failed := false;
  begin
    perform public.moderate_case_report(
      v_report_id,
      'approved',
      'Validación adversarial de contacto público.',
      'Sector 300 123 4567',
      'Descripción pública ficticia suficientemente extensa.'
    );
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed
    or (select moderation_status from public.case_reports where id = v_report_id) <> 'pending' then
    raise exception 'Sighting moderation accepted an embedded public phone number';
  end if;

  v_failed := false;
  begin
    perform public.moderate_case_report(
      v_report_id, 'approved', 'no',
      'Sector público aproximado',
      'Descripción pública ficticia suficientemente extensa.'
    );
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Sighting moderation accepted a reason shorter than three characters';
  end if;

  v_failed := false;
  begin
    perform public.moderate_case_report(
      v_report_id, 'approved', 'Razón interna ficticia válida.',
      repeat('x', 241),
      'corta'
    );
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Sighting moderation accepted invalid public field lengths';
  end if;

  v_queue := public.get_pending_case_reports();
  if jsonb_array_length(v_queue) <> 1
    or v_queue #>> '{0,id}' <> v_report_id::text
    or v_queue #>> '{0,reportContext}' <> 'sighting_care' then
    raise exception 'Information moderation queue is incorrect';
  end if;
  v_queue := public.get_contact_followup_queue();
  if not (v_queue @> jsonb_build_array(jsonb_build_object(
    'reportId', v_report_id,
    'phone', '3111111111'
  ))) then
    raise exception 'Contact queue did not return authorized private contact';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where actor_id = v_moderator and action = 'contact_followup_queue_accessed'
  ) then
    raise exception 'Contact queue access was not audited';
  end if;

  v_result := public.log_contact_followup(
    v_case_id,
    v_report_id,
    v_contact_id,
    'informante',
    'llamada',
    'requiere_seguimiento',
    'Resumen privado ficticio de contacto realizado.',
    now() + interval '1 day'
  );
  if v_result ->> 'followupId' is null
    or not exists (
      select 1 from public.contact_followups
      where id = (v_result ->> 'followupId')::uuid
        and created_by = v_moderator
        and contact_status = 'requiere_seguimiento'
    ) then
    raise exception 'Contact follow-up was not persisted';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where entity_id = (v_result ->> 'followupId')::uuid
      and action = 'contact_followup_logged'
  ) then
    raise exception 'Contact follow-up was not audited';
  end if;

  perform public.moderate_case_report(
    v_report_id,
    'approved',
    'Avistamiento ficticio revisado por moderación.',
    'Hospital, sector aproximado',
    'La persona habría sido vista en un punto de atención.'
  );
  select to_jsonb(card) into v_public
  from public.public_case_cards card where id = v_case_id;
  if (v_public ->> 'approved_reports_count')::integer <> 1
    or (v_public ->> 'approved_sightings_count')::integer <> 1
    or v_public ->> 'latest_approved_sighting_location' <> 'Hospital, sector aproximado'
    or jsonb_array_length(v_public -> 'approved_sightings') <> 1
    or jsonb_array_length(v_public -> 'sightings') <> 1 then
    raise exception 'Approved sighting did not update public card aliases';
  end if;
  if v_public::text like '%Hospital privado ficticio%'
    or v_public::text like '%Descripción privada ficticia%'
    or v_public::text like '%3111111111%' then
    raise exception 'Approved sighting exposed original private content';
  end if;
  if (select condition_status from public.cases where id = v_case_id) <> 'missing' then
    raise exception 'Sighting moderation changed case condition';
  end if;
  v_queue := public.get_contact_followup_queue();
  if not (v_queue @> jsonb_build_array(jsonb_build_object(
    'reportId', v_report_id,
    'moderationStatus', 'approved',
    'lastFollowupStatus', 'requiere_seguimiento'
  )))
    or not exists (
      select 1
      from jsonb_array_elements(v_queue) item
      where item ->> 'reportId' = v_report_id::text
        and (item ->> 'nextFollowupAt')::timestamptz > now()
    ) then
    raise exception 'Open scheduled follow-up disappeared after report approval';
  end if;

  -- A follow-up sent with report_id NULL targets the selected initial contact,
  -- not every report in the case. Historical and subsequently-created
  -- sightings must keep their own independent queue lifecycle.
  perform public.log_contact_followup(
    v_case_id,
    null,
    v_initial_contact_id,
    'reportante_inicial',
    'llamada',
    'requiere_seguimiento',
    'Seguimiento ficticio abierto para el reportante inicial.',
    now() + interval '3 days'
  );
  if not exists (
    select 1
    from public.contact_followups
    where case_id = v_case_id
      and report_id is null
      and contact_id = v_initial_contact_id
      and contact_status = 'requiere_seguimiento'
  ) then
    raise exception 'Case-level initial-contact follow-up was not persisted';
  end if;

  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'case_information',
    'caseId', v_case_id,
    'reportType', 'sighting',
    'reportContext', 'sighting_alive',
    'eventAt', '2026-08-12T10:00:00-05:00',
    'location', 'Segundo lugar privado ficticio',
    'description', 'Segundo avistamiento ficticio pendiente de revision.',
    'reporterName', 'Segundo Informante Ficticio',
    'phone', '3444444444',
    'requestFingerprint', repeat('e', 64)
  ));
  select r.id, rc.id
  into v_second_sighting_report_id, v_second_sighting_contact_id
  from public.case_reports r
  join public.reporter_contacts rc on rc.report_id = r.id
  where r.tracking_code = v_result ->> 'tracking_code';

  v_queue := public.get_contact_followup_queue();
  if jsonb_array_length(v_queue) <> 3
    or (select count(distinct item ->> 'reportId') from jsonb_array_elements(v_queue) item) <> 3
    or not (v_queue @> jsonb_build_array(jsonb_build_object(
      'reportId', v_initial_report_id,
      'contactId', v_initial_contact_id,
      'lastFollowupStatus', 'requiere_seguimiento',
      'followupCount', 1
    )))
    or not (v_queue @> jsonb_build_array(jsonb_build_object(
      'reportId', v_report_id,
      'lastFollowupStatus', 'requiere_seguimiento',
      'followupCount', 1
    )))
    or not (v_queue @> jsonb_build_array(jsonb_build_object(
      'reportId', v_second_sighting_report_id,
      'contactId', v_second_sighting_contact_id,
      'moderationStatus', 'pending',
      'lastFollowupStatus', null,
      'followupCount', 0
    ))) then
    raise exception 'Case-level open follow-up leaked across report rows or duplicated cards';
  end if;

  perform public.log_contact_followup(
    v_case_id,
    null,
    v_initial_contact_id,
    'reportante_inicial',
    'llamada',
    'cerrado',
    'Seguimiento ficticio cerrado para el reportante inicial.',
    null
  );
  v_queue := public.get_contact_followup_queue();
  if jsonb_array_length(v_queue) <> 2
    or v_queue @> jsonb_build_array(jsonb_build_object('reportId', v_initial_report_id))
    or not (v_queue @> jsonb_build_array(jsonb_build_object(
      'reportId', v_report_id,
      'lastFollowupStatus', 'requiere_seguimiento'
    )))
    or not (v_queue @> jsonb_build_array(jsonb_build_object(
      'reportId', v_second_sighting_report_id,
      'moderationStatus', 'pending',
      'lastFollowupStatus', null
    ))) then
    raise exception 'Closing initial-contact follow-up hid historical or future sightings';
  end if;

  v_failed := false;
  begin
    perform public.moderate_case_report(
      v_report_id,
      'approved',
      'Intento ficticio de moderación repetida.',
      'Otro sector público aproximado',
      'Otra descripción pública ficticia revisada.'
    );
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Already moderated report was accepted again';
  end if;

  -- Sensitive public submissions remain pending and never confirm a death or
  -- alter a case condition.
  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'case_information',
    'caseId', v_case_id,
    'reportType', 'possible_deceased',
    'location', 'Lugar privado ficticio A',
    'description', 'Información ficticia sensible sobre un posible fallecimiento.',
    'phone', '3222222222',
    'requestFingerprint', repeat('c', 64)
  ));
  select r.id, rc.id
  into v_sensitive_report_id, v_sensitive_contact_id
  from public.case_reports r
  join public.reporter_contacts rc on rc.report_id = r.id
  where r.tracking_code = v_result ->> 'tracking_code';
  if not exists (
    select 1 from public.case_reports
    where tracking_code = v_result ->> 'tracking_code'
      and report_type = 'possible_deceased'
      and moderation_status = 'pending'
      and is_sensitive = true
      and urgency_level = 'normal'
  ) then
    raise exception 'possible_deceased safety flags are incorrect';
  end if;

  v_failed := false;
  begin
    perform public.moderate_case_report(
      v_sensitive_report_id,
      'approved',
      'Intento ficticio de publicación de reporte sensible.',
      'Sector público aproximado',
      'Descripción pública ficticia suficientemente extensa.'
    );
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed
    or (select moderation_status from public.case_reports where id = v_sensitive_report_id) <> 'pending' then
    raise exception 'Non-sighting report was approved for public display';
  end if;

  -- An explicit close is authoritative for the contact workflow. It removes
  -- the item even when moderation remains pending.
  perform public.log_contact_followup(
    v_case_id,
    v_sensitive_report_id,
    v_sensitive_contact_id,
    'informante',
    'llamada',
    'cerrado',
    'Seguimiento ficticio cerrado sin publicaciÃ³n.',
    null
  );
  v_queue := public.get_contact_followup_queue();
  if v_queue @> jsonb_build_array(jsonb_build_object('reportId', v_sensitive_report_id)) then
    raise exception 'Explicitly closed follow-up remained solely because moderation is pending';
  end if;
  if (select moderation_status from public.case_reports where id = v_sensitive_report_id) <> 'pending' then
    raise exception 'Closing contact follow-up changed report moderation status';
  end if;

  v_result := public.submit_public_report(jsonb_build_object(
    'kind', 'case_information',
    'caseId', v_case_id,
    'reportType', 'possible_trapped',
    'location', 'Lugar privado ficticio B',
    'description', 'Información ficticia urgente sobre una posible persona atrapada.',
    'phone', '3333333333',
    'requestFingerprint', repeat('d', 64)
  ));
  select r.id, rc.id
  into v_trapped_report_id, v_trapped_contact_id
  from public.case_reports r
  join public.reporter_contacts rc on rc.report_id = r.id
  where r.tracking_code = v_result ->> 'tracking_code';
  if not exists (
    select 1 from public.case_reports
    where id = v_trapped_report_id
      and report_type = 'possible_trapped'
      and moderation_status = 'pending'
      and is_sensitive = true
      and urgency_level = 'urgent'
  ) then
    raise exception 'possible_trapped safety flags are incorrect';
  end if;
  if (select condition_status from public.cases where id = v_case_id) <> 'missing' then
    raise exception 'Sensitive report changed the case status';
  end if;

  perform public.log_contact_followup(
    v_case_id,
    v_trapped_report_id,
    v_trapped_contact_id,
    'informante',
    'whatsapp',
    'no_respondio',
    'Intento ficticio sin respuesta; requiere nuevo contacto.',
    now() + interval '2 days'
  );
  perform public.moderate_case_report(
    v_trapped_report_id,
    'rejected',
    'Reporte ficticio descartado, seguimiento de contacto aÃºn abierto.',
    null,
    null
  );
  v_queue := public.get_contact_followup_queue();
  if not (v_queue @> jsonb_build_array(jsonb_build_object(
    'reportId', v_trapped_report_id,
    'moderationStatus', 'rejected',
    'lastFollowupStatus', 'no_respondio'
  )))
    or not exists (
      select 1
      from jsonb_array_elements(v_queue) item
      where item ->> 'reportId' = v_trapped_report_id::text
        and (item ->> 'nextFollowupAt')::timestamptz > now()
    ) then
    raise exception 'Open scheduled follow-up disappeared after report rejection';
  end if;

  -- Reference and allowed-source validation exists in both preview and import.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_failed := false;
  begin
    perform public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Sin Referencia SQL',
      'approximate_age', '44',
      'source_name', 'Medicina Legal',
      'source_reference', ''
    )));
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Preview accepted an empty official source reference';
  end if;

  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Sin Referencia SQL',
      'approximate_age', '44',
      'source_name', 'Medicina Legal',
      'source_reference', ''
    )), 'Validación ficticia de referencia oficial obligatoria');
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Import accepted an empty official source reference';
  end if;

  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Sin Fuente SQL',
      'approximate_age', '45',
      'source_reference', 'Referencia-ficticia-sin-fuente'
    )), 'Validación ficticia de fuente oficial obligatoria');
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Import accepted a missing official source name';
  end if;

  v_failed := false;
  begin
    perform public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Con Contacto SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-ficticia-contacto',
      'public_description', 'Solicitar información a contacto@example.invalid'
    )));
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Official preview accepted embedded public contact information';
  end if;

  v_result := public.preview_official_deceased_import(jsonb_build_array(
    jsonb_build_object(
      'full_name', 'Persona Ficticia Duplicada SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-ficticia-duplicada-a'
    ),
    jsonb_build_object(
      'full_name', '  PERSONA FICTICIA DUPLICADA SQL  ',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-ficticia-duplicada-b'
    )
  ));
  if v_result #>> '{0,decision}' <> 'review_required'
    or v_result #>> '{1,decision}' <> 'review_required'
    or v_result #>> '{0,reviewReason}' <> 'duplicate_normalized_name_in_file' then
    raise exception 'Duplicate normalized names were not marked for manual review';
  end if;
  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(
      jsonb_build_object(
        'full_name', 'Persona Ficticia Duplicada SQL',
        'source_name', 'Medicina Legal',
        'source_reference', 'Referencia-ficticia-duplicada-a'
      ),
      jsonb_build_object(
        'full_name', 'PERSONA FICTICIA DUPLICADA SQL',
        'source_name', 'Medicina Legal',
        'source_reference', 'Referencia-ficticia-duplicada-b'
      )
    ), 'Validación ficticia de duplicados por nombre normalizado');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed or exists (
    select 1 from public.people
    where normalized_name = public.normalize_person_name('Persona Ficticia Duplicada SQL')
  ) then
    raise exception 'Duplicate normalized-name batch was not blocked atomically';
  end if;

  v_result := public.preview_official_deceased_import(jsonb_build_array(
    jsonb_build_object(
      'full_name', 'Persona Ficticia Referencia Uno SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-ficticia-repetida'
    ),
    jsonb_build_object(
      'full_name', 'Persona Ficticia Referencia Dos SQL',
      'source_name', 'Medicina Legal',
      'source_reference', ' REFERENCIA-FICTICIA-REPETIDA '
    )
  ));
  if v_result #>> '{0,decision}' <> 'review_required'
    or v_result #>> '{1,decision}' <> 'review_required'
    or v_result #>> '{0,reviewReason}' <> 'duplicate_source_reference_in_file' then
    raise exception 'Duplicate source references were not marked for manual review';
  end if;
  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(
      jsonb_build_object(
        'full_name', 'Persona Ficticia Referencia Uno SQL',
        'source_name', 'Medicina Legal',
        'source_reference', 'Referencia-ficticia-repetida'
      ),
      jsonb_build_object(
        'full_name', 'Persona Ficticia Referencia Dos SQL',
        'source_name', 'Medicina Legal',
        'source_reference', 'REFERENCIA-FICTICIA-REPETIDA'
      )
    ), 'Validación ficticia de referencias oficiales duplicadas');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Duplicate source-reference batch was not blocked';
  end if;

  -- One official publication reference may legitimately identify many rows.
  -- source_row is the private, composite idempotency key for that case.
  v_result := public.preview_official_deceased_import(jsonb_build_array(
    jsonb_build_object(
      'source_row', '65',
      'reported_unit', 'Pereira',
      'full_name', 'Persona Ficticia Fuente Compartida Uno SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    ),
    jsonb_build_object(
      'source_row', '66',
      'reported_unit', 'Cali',
      'full_name', 'Persona Ficticia Fuente Compartida Dos SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    )
  ));
  if v_result #>> '{0,decision}' <> 'create'
    or v_result #>> '{1,decision}' <> 'create' then
    raise exception 'Distinct source rows sharing one reference were blocked';
  end if;

  v_result := public.import_official_deceased(jsonb_build_array(
    jsonb_build_object(
      'source_row', '65',
      'reported_unit', 'Pereira',
      'full_name', 'Persona Ficticia Fuente Compartida Uno SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    ),
    jsonb_build_object(
      'source_row', '66',
      'reported_unit', 'Cali',
      'full_name', 'Persona Ficticia Fuente Compartida Dos SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    )
  ), 'Prueba ficticia de referencia oficial compartida por filas');
  if (v_result ->> 'created')::integer <> 2
    or (select count(*) from public.official_deceased_import_entries
        where source_reference = 'Lista oficial ficticia compartida') <> 2
    or exists (
      select 1 from public.cases
      where authority_reference_private <> 'Lista oficial ficticia compartida'
        and id in (
          select case_id from public.official_deceased_import_entries
          where source_reference = 'Lista oficial ficticia compartida'
        )
  ) then
    raise exception 'Shared-reference official import did not preserve exact private attribution';
  end if;
  select count(*) into v_count_before
  from public.audit_logs
  where action = 'official_deceased_imported'
    and entity_id in (
      select case_id from public.official_deceased_import_entries
      where source_reference = 'Lista oficial ficticia compartida'
    );

  v_result := public.import_official_deceased(jsonb_build_array(
    jsonb_build_object(
      'source_row', '65',
      'reported_unit', 'Pereira',
      'full_name', 'Persona Ficticia Fuente Compartida Uno SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    ),
    jsonb_build_object(
      'source_row', '66',
      'reported_unit', 'Cali',
      'full_name', 'Persona Ficticia Fuente Compartida Dos SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    )
  ), 'Reintento ficticio de referencia oficial compartida por filas');
  if (v_result ->> 'skipped')::integer <> 2
    or (select count(*) from public.official_deceased_import_entries
        where source_reference = 'Lista oficial ficticia compartida') <> 2
    or (select count(*)
        from public.audit_logs
        where action = 'official_deceased_imported'
          and entity_id in (
            select case_id from public.official_deceased_import_entries
            where source_reference = 'Lista oficial ficticia compartida'
          )) <> v_count_before then
    raise exception 'Composite source-row replay was not idempotent';
  end if;

  -- A later batch may add another row from the same publication. The common
  -- authority reference must not make a fresh composite source row ambiguous.
  v_result := public.preview_official_deceased_import(jsonb_build_array(
    jsonb_build_object(
      'source_row', '67',
      'reported_unit', 'Manizales',
      'full_name', 'Persona Ficticia Fuente Compartida Tres SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    )
  ));
  if v_result #>> '{0,decision}' <> 'create' then
    raise exception 'Incremental distinct source row sharing one reference was blocked';
  end if;

  v_result := public.import_official_deceased(jsonb_build_array(
    jsonb_build_object(
      'source_row', '67',
      'reported_unit', 'Manizales',
      'full_name', 'Persona Ficticia Fuente Compartida Tres SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia compartida'
    )
  ), 'Prueba ficticia incremental de referencia oficial compartida');
  if (v_result ->> 'created')::integer <> 1
    or (select count(*) from public.official_deceased_import_entries
        where source_reference = 'Lista oficial ficticia compartida') <> 3
    or not exists (
      select 1
      from public.official_deceased_import_entries e
      join public.cases c on c.id = e.case_id
      where e.source_reference = 'Lista oficial ficticia compartida'
        and e.source_row = 67
        and c.authority_reference_private = 'Lista oficial ficticia compartida'
    ) then
    raise exception 'Incremental shared-reference import did not preserve composite identity';
  end if;

  v_result := public.preview_official_deceased_import(jsonb_build_array(
    jsonb_build_object(
      'source_row', '301',
      'full_name', 'Persona Ficticia Colision Uno SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia con colision'
    ),
    jsonb_build_object(
      'source_row', '301',
      'full_name', 'Persona Ficticia Colision Dos SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia con colision'
    )
  ));
  if v_result #>> '{0,decision}' <> 'review_required'
    or v_result #>> '{1,decision}' <> 'review_required'
    or v_result #>> '{0,reviewReason}' <> 'duplicate_source_reference_row_in_file' then
    raise exception 'Duplicate composite official source key was not flagged';
  end if;
  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(
      jsonb_build_object(
        'source_row', '301',
        'full_name', 'Persona Ficticia Colision Uno SQL',
        'source_name', 'Medicina Legal',
        'source_reference', 'Lista oficial ficticia con colision'
      ),
      jsonb_build_object(
        'source_row', '301',
        'full_name', 'Persona Ficticia Colision Dos SQL',
        'source_name', 'Medicina Legal',
        'source_reference', 'Lista oficial ficticia con colision'
      )
    ), 'Prueba ficticia de colision de referencia y fila');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed or exists (
    select 1 from public.people
    where normalized_name in (
      public.normalize_person_name('Persona Ficticia Colision Uno SQL'),
      public.normalize_person_name('Persona Ficticia Colision Dos SQL')
    )
  ) then
    raise exception 'Duplicate composite official source key was not blocked atomically';
  end if;

  v_failed := false;
  begin
    perform public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
      'source_row', '302',
      'reported_unit', 'Unidad 300 123 4567',
      'full_name', 'Persona Ficticia Unidad Insegura SQL',
      'source_name', 'Medicina Legal',
      'source_reference', 'Lista oficial ficticia unidad insegura'
    )));
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Official preview accepted contact information in reported_unit';
  end if;

  -- A normalized-name match is never enough to declare an existing missing
  -- person deceased. Homonyms and conflicting biographical data require an
  -- explicit manual resolution outside the bulk importer.
  insert into public.people (
    full_name, normalized_name, approximate_age, is_minor, gender, is_test_data
  ) values (
    'Persona Ficticia Existente SQL',
    public.normalize_person_name('Persona Ficticia Existente SQL'),
    52, false, 'Valor previo preservado', false
  ) returning id into v_existing_person_id;

  insert into public.cases (
    person_id, slug, publication_status, condition_status,
    verification_level, urgency_level, authority_reference_private
  ) values (
    v_existing_person_id, 'persona-ficticia-existente-sql', 'published',
    'missing', 'moderator_reviewed', 'normal',
    'Referencia-oficial-ficticia-existente'
  ) returning id into v_existing_case_id;

  v_result := public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Existente SQL',
    'approximate_age', '81',
    'source_row', '64',
    'reported_unit', 'Unidad ficticia de otra persona',
    'gender', 'Este campo fuera del contrato debe ignorarse',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-existente',
    'date_confirmed', ''
  )));
  if v_result #>> '{0,decision}' <> 'review_required'
    or v_result #>> '{0,reviewReason}' <> 'existing_normalized_name_requires_manual_review' then
    raise exception 'Name-only official match was not routed to manual review';
  end if;

  select count(*) into v_count_before
  from public.audit_logs
  where entity_id = v_existing_case_id;
  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Existente SQL',
      'approximate_age', '81',
      'source_row', '64',
      'reported_unit', 'Unidad ficticia de otra persona',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-oficial-ficticia-existente',
      'date_confirmed', ''
    )), 'Intento ficticio de coincidencia insegura solo por nombre');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Name-only official match was imported automatically';
  end if;
  if not exists (
    select 1 from public.cases
    where id = v_existing_case_id
      and condition_status = 'missing'
      and verification_level = 'moderator_reviewed'
      and authority_reference_private = 'Referencia-oficial-ficticia-existente'
      and reported_unit is null
  ) then
    raise exception 'Blocked name-only match changed the existing case';
  end if;
  if (select approximate_age from public.people where id = v_existing_person_id) <> 52
    or (select gender from public.people where id = v_existing_person_id) <> 'Valor previo preservado'
    or exists (
      select 1 from public.official_deceased_import_entries
      where case_id = v_existing_case_id
    )
    or (select count(*) from public.audit_logs where entity_id = v_existing_case_id) <> v_count_before
    or exists (
      select 1 from public.moderation_actions
      where case_id = v_existing_case_id and action = 'official_deceased_import'
    ) then
    raise exception 'Blocked name-only match mutated person, ledger, moderation or audit data';
  end if;

  -- A legacy reference/name match cannot be treated as an idempotent replay
  -- while the existing case is still missing and not authority-confirmed.
  v_result := public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Existente SQL',
    'approximate_age', '52',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-existente',
    'date_confirmed', ''
  )));
  if v_result #>> '{0,decision}' <> 'review_required'
    or v_result #>> '{0,reviewReason}' <> 'source_reference_existing_case_not_authority_confirmed' then
    raise exception 'Unsafe legacy reference replay was not routed to manual review';
  end if;
  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Existente SQL',
      'approximate_age', '52',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-oficial-ficticia-existente',
      'date_confirmed', ''
    )), 'Intento ficticio de replay legacy sobre caso no confirmado');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed
    or not exists (
      select 1 from public.cases
      where id = v_existing_case_id
        and condition_status = 'missing'
        and verification_level = 'moderator_reviewed'
        and public_source_label is null
    )
    or (select count(*) from public.audit_logs where entity_id = v_existing_case_id) <> v_count_before then
    raise exception 'Unsafe legacy reference replay changed or skipped the missing case';
  end if;

  -- Legacy seven-column callers remain supported. A new exact authority
  -- reference creates once; the same reference and normalized name then skips.
  v_result := public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Legacy SQL',
    'approximate_age', '73',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-legacy',
    'public_description', 'Registro ficticio legacy dentro de rollback.',
    'last_seen_location_public', 'Unidad ficticia legacy',
    'date_confirmed', ''
  )));
  if v_result #>> '{0,decision}' <> 'create' then
    raise exception 'Legacy seven-column preview cannot create a new official row';
  end if;
  v_result := public.import_official_deceased(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Legacy SQL',
    'approximate_age', '73',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-legacy',
    'public_description', 'Registro ficticio legacy dentro de rollback.',
    'last_seen_location_public', 'Unidad ficticia legacy',
    'date_confirmed', ''
  )), 'Prueba ficticia compatible con importador web legacy');
  if (v_result ->> 'created')::integer <> 1 then
    raise exception 'Legacy seven-column official import did not create one row';
  end if;
  v_result := public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Legacy SQL',
    'approximate_age', '99',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-legacy',
    'public_description', 'Contenido distinto ignorado por compatibilidad legacy.',
    'last_seen_location_public', 'Otra unidad ficticia legacy',
    'date_confirmed', ''
  )));
  if v_result #>> '{0,decision}' <> 'already_imported' then
    raise exception 'Exact legacy authority reference and name were not recognized safely';
  end if;
  v_result := public.import_official_deceased(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Legacy SQL',
    'approximate_age', '99',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-legacy',
    'public_description', 'Contenido distinto ignorado por compatibilidad legacy.',
    'last_seen_location_public', 'Otra unidad ficticia legacy',
    'date_confirmed', ''
  )), 'Reintento ficticio compatible con importador web legacy');
  if (v_result ->> 'skipped')::integer <> 1 then
    raise exception 'Legacy exact-reference replay was not skipped';
  end if;

  v_result := public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Oficial SQL',
    'approximate_age', '41',
    'source_row', '65',
    'reported_unit', 'Pereira',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-001'
  )));
  if v_result #>> '{0,decision}' <> 'create'
    or v_result #>> '{0,sourceName}' <> 'Medicina Legal'
    or v_result #>> '{0,sourceRow}' <> '65'
    or v_result #>> '{0,reportedUnit}' <> 'Pereira' then
    raise exception 'Valid official import preview is incorrect';
  end if;

  v_result := public.import_official_deceased(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Oficial SQL',
    'approximate_age', '41',
    'source_row', '65',
    'reported_unit', 'Pereira',
    'gender', '',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-001',
    'public_description', 'Registro ficticio usado solo dentro de una transacción con rollback.',
    'last_seen_location_public', 'Lugar público ficticio',
    'date_confirmed', ''
  )), 'Prueba local explícita y reversible del importador oficial');
  if (v_result ->> 'created')::integer <> 1 then
    raise exception 'Official import did not create one case';
  end if;

  select c.id into v_official_case_id
  from public.cases c
  join public.people p on p.id = c.person_id
  where p.full_name = 'Persona Ficticia Oficial SQL';
  if not exists (
    select 1 from public.cases
    where id = v_official_case_id
      and condition_status = 'deceased_confirmed'
      and verification_level = 'authority_confirmed'
      and publication_status = 'published'
      and urgency_level = 'normal'
      and public_source_label = 'Medicina Legal'
      and reported_unit = 'Pereira'
      and authority_reference_private = 'Referencia-oficial-ficticia-001'
      and resolved_at is null
      and primary_public_photo_path is null
  ) then
    raise exception 'Official case flags or source attribution are incorrect';
  end if;
  if not exists (select 1 from public.status_history where case_id = v_official_case_id) then
    raise exception 'Official status history is missing';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where entity_id = v_official_case_id and action = 'official_deceased_imported'
  ) then
    raise exception 'Official audit log is missing';
  end if;
  if not exists (
    select 1 from public.moderation_actions
    where case_id = v_official_case_id and action = 'official_deceased_import'
  ) then
    raise exception 'Official moderation action is missing';
  end if;
  if not exists (
    select 1
    from public.official_deceased_import_entries
    where case_id = v_official_case_id
      and source_reference = 'Referencia-oficial-ficticia-001'
      and source_row = 65
      and payload_fingerprint ~ '^[0-9a-f]{64}$'
      and imported_by = v_admin
  ) then
    raise exception 'Official source-row ledger entry is missing';
  end if;
  if has_function_privilege(
      'anon',
      'public.official_deceased_import_fingerprint(text,integer,text,text,text,text,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.official_deceased_import_fingerprint(text,integer,text,text,text,text,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.official_deceased_import_fingerprint(text,integer,text,text,text,text,text,integer)',
      'EXECUTE'
    ) then
    raise exception 'Public or service role can execute the private import fingerprint helper';
  end if;

  select count(*) into v_count_before
  from public.audit_logs
  where entity_id = v_official_case_id and action = 'official_deceased_imported';

  -- Only a canonically identical payload is an idempotent replay.
  v_result := public.import_official_deceased(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Oficial SQL',
    'approximate_age', '41',
    'source_row', '65',
    'reported_unit', 'Pereira',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-001',
    'public_description', 'Registro ficticio usado solo dentro de una transacción con rollback.',
    'last_seen_location_public', 'Lugar público ficticio',
    'date_confirmed', ''
  )), 'Reintento ficticio idempotente de la misma fuente oficial');
  if (v_result ->> 'skipped')::integer <> 1
    or (v_result ->> 'created')::integer <> 0
    or (v_result ->> 'updated')::integer <> 0
    or (select count(*) from public.audit_logs
        where entity_id = v_official_case_id and action = 'official_deceased_imported') <> v_count_before then
    raise exception 'Official import replay was not skipped without a new audit event';
  end if;

  -- Every persisted source-row field participates in the canonical payload
  -- fingerprint; changing any one of them must produce a different identity.
  if public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    ) = public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 42, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    )
    or public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    ) = public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Cali',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    )
    or public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    ) = public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'DescripciÃ³n ficticia distinta.', 'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    )
    or public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    ) = public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Otro lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    )
    or public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', null,
      'Referencia-oficial-ficticia-001', 65
    ) = public.official_deceased_import_fingerprint(
      'Persona Ficticia Oficial SQL', 41, 'Pereira',
      'Registro ficticio usado solo dentro de una transacciÃ³n con rollback.',
      'Lugar pÃºblico ficticio', '2026-08-12',
      'Referencia-oficial-ficticia-001', 65
    ) then
    raise exception 'A persisted source-row field is missing from the payload fingerprint';
  end if;

  -- Reusing the same source reference/row/name with changed content is not a
  -- replay. It must stop for review and leave all persisted data untouched.
  v_result := public.preview_official_deceased_import(jsonb_build_array(jsonb_build_object(
    'full_name', 'Persona Ficticia Oficial SQL',
    'approximate_age', '42',
    'source_row', '65',
    'reported_unit', 'Unidad ficticia modificada',
    'source_name', 'Medicina Legal',
    'source_reference', 'Referencia-oficial-ficticia-001',
    'public_description', 'Texto ficticio modificado que requiere revisión.',
    'last_seen_location_public', 'Otro lugar público ficticio',
    'date_confirmed', ''
  )));
  if v_result #>> '{0,decision}' <> 'review_required'
    or v_result #>> '{0,reviewReason}' <> 'source_reference_row_payload_changed' then
    raise exception 'Changed composite replay was not routed to manual review';
  end if;
  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(jsonb_build_object(
      'full_name', 'Persona Ficticia Oficial SQL',
      'approximate_age', '42',
      'source_row', '65',
      'reported_unit', 'Unidad ficticia modificada',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-oficial-ficticia-001',
      'public_description', 'Texto ficticio modificado que requiere revisión.',
      'last_seen_location_public', 'Otro lugar público ficticio',
      'date_confirmed', ''
    )), 'Intento ficticio de replay compuesto con contenido modificado');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Changed composite replay was imported';
  end if;
  if (select reported_unit from public.cases where id = v_official_case_id) <> 'Pereira' then
    raise exception 'Blocked changed replay mutated reported_unit';
  end if;
  if (select approximate_age from public.people where id = (
      select person_id from public.cases where id = v_official_case_id
    )) <> 41
    or (select count(*) from public.audit_logs
        where entity_id = v_official_case_id and action = 'official_deceased_imported') <> v_count_before then
    raise exception 'Blocked changed replay mutated person data or audit history';
  end if;

  v_failed := false;
  begin
    perform public.import_official_deceased(jsonb_build_array(jsonb_build_object(
      'full_name', 'Otra Persona Ficticia Conflicto SQL',
      'source_row', '65',
      'source_name', 'Medicina Legal',
      'source_reference', 'Referencia-oficial-ficticia-001'
    )), 'Validación ficticia de referencia ya asignada a otra persona');
  exception when sqlstate 'P0003' then
    v_failed := true;
  end;
  if not v_failed or exists (
    select 1 from public.people
    where normalized_name = public.normalize_person_name('Otra Persona Ficticia Conflicto SQL')
  ) then
    raise exception 'Official reference was reused for another person';
  end if;

  select to_jsonb(card) into v_public
  from public.public_case_cards card where id = v_official_case_id;
  if v_public ->> 'public_source_label' <> 'Medicina Legal'
    or v_public ->> 'condition_status' <> 'deceased_confirmed'
    or v_public ->> 'verification_level' <> 'authority_confirmed'
    or v_public ->> 'reported_unit' <> 'Pereira' then
    raise exception 'Official public card attribution is incorrect';
  end if;
  if v_public::text like '%Referencia-oficial-ficticia-001%'
    or v_public::text like '%authority_reference_private%' then
    raise exception 'Official private reference leaked publicly';
  end if;
  select to_jsonb(public_case) into v_public
  from public.get_public_case((
    select slug from public.cases where id = v_official_case_id
  )) public_case;
  if v_public ->> 'reported_unit' <> 'Pereira'
    or v_public ? 'gender'
    or v_public ? 'source_reference'
    or v_public ? 'authority_reference_private'
    or v_public::text like '%Referencia-oficial-ficticia-001%'
    or v_public::text like '%3000000000%' then
    raise exception 'get_public_case leaked private official or contact data';
  end if;
  select to_jsonb(public_case) into v_public
  from public.search_public_people(
    'Persona Ficticia Oficial SQL', 'deceased_confirmed', null, null, 24, 0
  ) public_case
  where id = v_official_case_id;
  if v_public ->> 'reported_unit' <> 'Pereira'
    or v_public ->> 'condition_status' <> 'deceased_confirmed'
    or v_public ->> 'verification_level' <> 'authority_confirmed'
    or v_public ? 'gender'
    or v_public ? 'source_reference'
    or v_public::text like '%Referencia-oficial-ficticia-001%' then
    raise exception 'search_public_people official projection is unsafe or incomplete';
  end if;

  -- The shared memorial portrait can only be applied by service_role, requires
  -- a real JPEG object, affects only non-test confirmed-deceased cases and is
  -- idempotent with one private audit record per effective case change.
  insert into storage.objects (bucket_id, name, metadata)
  values (
    'public-portraits',
    'memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    jsonb_build_object('mimetype', 'image/jpeg', 'size', 53824)
  ) on conflict (bucket_id, name) do nothing;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_failed := false;
  begin
    perform public.apply_deceased_memorial_portrait(
      'memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
      'https://project.supabase.co/storage/v1/object/public/public-portraits/memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
      53824,
      'Intento ficticio sin privilegio de servicio'
    );
  exception when sqlstate '42501' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Authenticated caller applied the deceased memorial portrait';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  v_result := public.apply_deceased_memorial_portrait(
    'memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    'https://project.supabase.co/storage/v1/object/public/public-portraits/memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    53824,
    'Aplicación ficticia y auditada de imagen conmemorativa'
  );
  select count(*)::integer into v_count
  from public.cases c
  join public.people p on p.id = c.person_id
  where c.condition_status = 'deceased_confirmed'
    and c.deleted_at is null
    and p.is_test_data = false;
  if (v_result ->> 'totalConfirmedDeceased')::integer <> v_count
    or (v_result ->> 'mediaLinked')::integer <> v_count
    or (v_result ->> 'cardsConfigured')::integer <> v_count
    or (select primary_public_photo_url from public.public_case_cards where id = v_official_case_id) <>
      'https://project.supabase.co/storage/v1/object/public/public-portraits/memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
    or (select count(*) from public.audit_logs where action = 'deceased_memorial_portrait_applied') <> v_count then
    raise exception 'Service memorial portrait application is incomplete or unaudited';
  end if;

  select count(*) into v_count_before
  from public.audit_logs where action = 'deceased_memorial_portrait_applied';
  v_result := public.apply_deceased_memorial_portrait(
    'memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    'https://project.supabase.co/storage/v1/object/public/public-portraits/memorial/deceased-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    53824,
    'Reintento ficticio de imagen conmemorativa'
  );
  if (v_result ->> 'mediaLinked')::integer <> 0
    or (v_result ->> 'cardsConfigured')::integer <> v_count
    or (select count(*) from public.audit_logs where action = 'deceased_memorial_portrait_applied') <> v_count_before then
    raise exception 'Memorial portrait replay was not idempotent';
  end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- Database ACL/RLS contracts are tested independently from application code.
  if to_regclass('storage.buckets') is not null
    and not exists (
      select 1
      from storage.buckets
      where id = 'public-portraits'
        and public = true
        and allowed_mime_types = array['image/jpeg']::text[]
    ) then
    raise exception 'public-portraits bucket must be public and JPEG-only';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.contact_followups'::regclass) then
    raise exception 'contact_followups RLS is not enabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.official_deceased_import_entries'::regclass)
    or not (select relforcerowsecurity from pg_class where oid = 'public.official_deceased_import_entries'::regclass) then
    raise exception 'Official import ledger RLS is not enabled and forced';
  end if;
  if has_table_privilege('anon', 'public.official_deceased_import_entries', 'SELECT')
    or has_table_privilege('anon', 'public.official_deceased_import_entries', 'INSERT')
    or has_table_privilege('authenticated', 'public.official_deceased_import_entries', 'SELECT')
    or has_table_privilege('authenticated', 'public.official_deceased_import_entries', 'INSERT')
    or has_table_privilege('authenticated', 'public.official_deceased_import_entries', 'UPDATE')
    or has_table_privilege('authenticated', 'public.official_deceased_import_entries', 'DELETE') then
    raise exception 'A public role has direct access to the official import ledger';
  end if;
  if has_table_privilege('anon', 'public.contact_followups', 'SELECT')
    or has_table_privilege('anon', 'public.contact_followups', 'INSERT')
    or has_table_privilege('anon', 'public.contact_followups', 'DELETE') then
    raise exception 'Anon has direct contact_followups privileges';
  end if;
  if not has_table_privilege('authenticated', 'public.contact_followups', 'SELECT')
    or has_table_privilege('authenticated', 'public.contact_followups', 'INSERT')
    or has_table_privilege('authenticated', 'public.contact_followups', 'UPDATE')
    or has_table_privilege('authenticated', 'public.contact_followups', 'DELETE') then
    raise exception 'Authenticated contact_followups privileges are not read-only';
  end if;
  if has_function_privilege('anon', 'public.get_pending_people_cases()', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_contact_followup_queue()', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_staff_media_asset(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.review_pending_person_case(uuid,text,text,text,text,uuid,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.log_contact_followup(uuid,uuid,uuid,text,text,text,text,timestamp with time zone)', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_admin_people_cases(text,integer,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.withdraw_person_case(uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_admin_case_message_threads(integer)', 'EXECUTE') then
    raise exception 'Anon can execute a staff-only RPC';
  end if;
  if has_function_privilege(
      'anon',
      'public.official_deceased_import_fingerprint(text,integer,text,text,text,text,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.official_deceased_import_fingerprint(text,integer,text,text,text,text,text,integer)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.official_deceased_import_fingerprint(text,integer,text,text,text,text,text,integer)',
      'EXECUTE'
    ) then
    raise exception 'A client role can execute the private official fingerprint helper';
  end if;
  if has_function_privilege('anon', 'public.bootstrap_initial_admin(uuid,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.bootstrap_initial_admin(uuid,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.bootstrap_initial_admin(uuid,text,text)', 'EXECUTE') then
    raise exception 'Initial admin bootstrap privileges are incorrect';
  end if;
  if has_function_privilege('anon', 'public.apply_deceased_memorial_portrait(text,text,integer,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.apply_deceased_memorial_portrait(text,text,integer,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.apply_deceased_memorial_portrait(text,text,integer,text)', 'EXECUTE') then
    raise exception 'Deceased memorial portrait privileges are incorrect';
  end if;
  if has_function_privilege('anon', 'public.manage_staff_profile(uuid,text,public.app_role,boolean,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.manage_staff_profile(uuid,text,public.app_role,boolean,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.manage_staff_profile(uuid,text,public.app_role,boolean,text)', 'EXECUTE') then
    raise exception 'Staff management privileges are incorrect';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'contact_followups'
      and policyname = 'contact_followups_staff_select'
      and cmd = 'SELECT'
  ) then
    raise exception 'contact_followups RLS policies are incomplete';
  end if;
  -- A published card can be withdrawn only by an administrator. The operation
  -- preserves rows and creates both moderation and audit evidence. The private
  -- inbox groups public submissions with their internal follow-up history.
  insert into public.people (full_name, normalized_name, approximate_age, is_test_data)
  values ('Persona Ficticia Para Retiro', 'persona ficticia para retiro', 52, false)
  returning id into v_withdraw_person_id;
  insert into public.cases (
    person_id, slug, publication_status, condition_status, verification_level,
    last_seen_location_public, published_at, created_by, reviewed_by
  ) values (
    v_withdraw_person_id, 'persona ficticia para retiro-con-espacios', 'published',
    'missing', 'moderator_reviewed', 'Sector ficticio', now(), v_admin, v_admin
  ) returning id into v_withdraw_case_id;
  insert into public.case_reports (case_id, report_type, description, tracking_code)
  values (v_withdraw_case_id, 'correction', 'Mensaje ficticio recibido desde la web.', 'EN-RETIRO-FICTICIO')
  returning id into v_report_id;
  insert into public.reporter_contacts (report_id, reporter_name, phone, preferred_contact_method)
  values (v_report_id, 'Informante Ficticio', '3000000000', 'llamada')
  returning id into v_contact_id;

  perform set_config('request.jwt.claim.sub', v_moderator::text, true);
  v_result := public.get_admin_people_cases('Persona Ficticia Para Retiro', 20, 0);
  if jsonb_array_length(v_result) <> 1
    or v_result #>> '{0,publicationStatus}' <> 'published'
    or v_result #>> '{0,fullName}' <> 'Persona Ficticia Para Retiro' then
    raise exception 'Admin people manager did not return the published fictitious case';
  end if;
  v_result := public.get_admin_case_message_threads(100);
  if not (v_result @> jsonb_build_array(jsonb_build_object(
    'caseId', v_withdraw_case_id,
    'messages', jsonb_build_array(jsonb_build_object(
      'reportId', v_report_id,
      'descriptionPrivate', 'Mensaje ficticio recibido desde la web.',
      'phone', '3000000000'
    ))
  ))) then
    raise exception 'Private case-message inbox did not group the incoming message';
  end if;
  v_failed := false;
  begin
    perform public.withdraw_person_case(v_withdraw_case_id, 'Intento ficticio de moderador');
  exception when sqlstate '42501' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Moderator withdrew a published person case';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := public.withdraw_person_case(
    v_withdraw_case_id,
    'Retiro ficticio solicitado y verificado por administración'
  );
  if coalesce((v_result ->> 'withdrawn')::boolean, false) is not true
    or exists (select 1 from public.public_case_cards where id = v_withdraw_case_id)
    or not exists (
      select 1 from public.cases
      where id = v_withdraw_case_id and publication_status = 'archived' and deleted_at is not null
    )
    or not exists (
      select 1 from public.moderation_actions
      where case_id = v_withdraw_case_id and action = 'archive'
        and metadata ->> 'operation' = 'withdraw_published_case'
    )
    or not exists (
      select 1 from public.audit_logs
      where entity_id = v_withdraw_case_id and action = 'published_person_case_withdrawn'
    ) then
    raise exception 'Audited published-person withdrawal did not preserve its contract';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'contact_followups'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'contact_followups has a direct mutation policy';
  end if;

  if exists (
    select 1
    from unnest(array[
      'public.people',
      'public.cases',
      'public.case_reports',
      'public.reporter_contacts',
      'public.media_assets',
      'public.moderation_actions',
      'public.status_history',
      'public.audit_logs'
    ]) sensitive_table(name)
    where has_table_privilege('authenticated', sensitive_table.name, 'INSERT')
       or has_table_privilege('authenticated', sensitive_table.name, 'UPDATE')
       or has_table_privilege('authenticated', sensitive_table.name, 'DELETE')
       or has_table_privilege('anon', sensitive_table.name, 'INSERT')
       or has_table_privilege('anon', sensitive_table.name, 'UPDATE')
       or has_table_privilege('anon', sensitive_table.name, 'DELETE')
  ) then
    raise exception 'A public role has direct mutation privileges on a sensitive table';
  end if;
  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.profiles', 'INSERT')
    or has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.profiles', 'DELETE')
    or has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'profiles privileges are not authenticated read-only';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_case_cards'
      and column_name in (
        'phone', 'email', 'reporter_name', 'contact_id', 'reporter_contacts',
        'location_private', 'authority_reference_private', 'private_path',
        'report_context', 'gender', 'source_reference', 'source_row',
        'payload_fingerprint', 'imported_by'
      )
  ) then
    raise exception 'Private columns leaked into public projection';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_case_cards'
      and column_name = 'reported_unit'
  ) then
    raise exception 'Safe reported_unit is absent from the public projection';
  end if;
  if (select public_source_label from public.public_case_cards where id = v_case_id) is not null then
    raise exception 'Unverified missing case received a public authority label';
  end if;

  v_result := public.reports_debug_snapshot();
  if v_result ->> 'schemaVersion' <> '202608130004'
    or v_result ->> 'lastMigrationApplied' <> '202608130004'
    or coalesce((v_result ->> 'deceasedFilterReady')::boolean, false) is not true
    or (v_result #>> '{publishedCounts,missing}')::bigint <> (
      select count(*)
      from public.cases c
      join public.people p on p.id = c.person_id
      where c.publication_status = 'published'
        and c.condition_status = 'missing'
        and c.deleted_at is null
        and p.is_test_data = false
    )
    or (v_result #>> '{publishedCounts,deceasedConfirmed}')::bigint <> (
      select count(*)
      from public.cases c
      join public.people p on p.id = c.person_id
      where c.publication_status = 'published'
        and c.condition_status = 'deceased_confirmed'
        and c.verification_level = 'authority_confirmed'
        and c.deleted_at is null
        and p.is_test_data = false
    )
    or not (v_result -> 'tables' @> jsonb_build_array(jsonb_build_object(
      'name', 'contact_followups', 'found', true
    )))
    or not (v_result -> 'tables' @> jsonb_build_array(jsonb_build_object(
      'name', 'official_deceased_import_entries', 'found', true,
      'rlsEnabled', true, 'rlsForced', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'review_pending_person_case', 'found', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'bootstrap_initial_admin', 'found', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'manage_staff_profile', 'found', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'get_admin_people_cases', 'found', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'withdraw_person_case', 'found', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'get_admin_case_message_threads', 'found', true
    )))
    or not (v_result -> 'rpcs' @> jsonb_build_array(jsonb_build_object(
      'name', 'apply_deceased_memorial_portrait', 'found', true
    )))
    or not (v_result -> 'buckets' @> jsonb_build_array(jsonb_build_object(
      'name', 'report-evidence'
    )))
    or not (v_result -> 'buckets' @> jsonb_build_array(jsonb_build_object(
      'name', 'public-portraits'
    ))) then
    raise exception 'Reports debug snapshot is stale';
  end if;

  if pg_get_functiondef('public.submit_public_report_core(jsonb)'::regprocedure)
      ~* '(pg_exception_detail|pg_exception_context|''message''\s*,\s*v_error_message|message\s*=\s*v_error_message)' then
    raise exception 'Report diagnostics can expose database messages or failing-row details';
  end if;
end;
$$;

rollback;

select 'database integration flows passed' as result;
