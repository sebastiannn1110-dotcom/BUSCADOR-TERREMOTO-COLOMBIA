-- Apply one sanitized memorial portrait to every non-test confirmed-deceased
-- case. This is an explicit service-role operation: public/authenticated clients
-- cannot execute it, the Storage object must already exist, and each effective
-- change is recorded in the private audit trail.

create or replace function public.apply_deceased_memorial_portrait(
  p_public_path text,
  p_public_url text,
  p_size_bytes integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  v_public_path text := btrim(coalesce(p_public_path, ''));
  v_public_url text := btrim(coalesce(p_public_url, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_object_found boolean := false;
  v_total integer := 0;
  v_media_linked integer := 0;
  v_cards_configured integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required for memorial portrait application';
  end if;
  if v_public_path !~ '^memorial/deceased-[a-f0-9]{64}\.jpg$' then
    raise exception using errcode = '22023', message = 'Invalid memorial portrait path';
  end if;
  if v_public_url !~ '^https://[^[:space:]]+/storage/v1/object/public/public-portraits/memorial/deceased-[a-f0-9]{64}\.jpg$'
    or right(v_public_url, char_length(v_public_path)) <> v_public_path then
    raise exception using errcode = '22023', message = 'Invalid memorial portrait public URL';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 8388608 then
    raise exception using errcode = '22023', message = 'Invalid memorial portrait size';
  end if;
  if char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'Memorial portrait reason must contain between 10 and 1000 characters';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception using errcode = '42P01', message = 'Storage objects table is unavailable';
  end if;

  execute $storage$
    select exists (
      select 1
      from storage.objects
      where bucket_id = 'public-portraits' and name = $1
    )
  $storage$ into v_object_found using v_public_path;
  if not v_object_found then
    raise exception using errcode = 'P0002', message = 'Memorial portrait object does not exist in public-portraits';
  end if;

  perform pg_advisory_xact_lock(824628171, 130004);

  create temporary table if not exists pg_temp.memorial_changed_cases (
    case_id uuid primary key
  ) on commit drop;
  truncate table pg_temp.memorial_changed_cases;

  insert into pg_temp.memorial_changed_cases (case_id)
  select c.id
  from public.cases c
  join public.people p on p.id = c.person_id
  where c.condition_status = 'deceased_confirmed'
    and c.deleted_at is null
    and p.is_test_data = false
    and not exists (
      select 1
      from public.media_assets m
      where m.case_id = c.id
        and m.asset_type = 'portrait'
        and m.storage_bucket = 'public-portraits'
        and m.private_path = v_public_path
        and m.public_path = v_public_url
    );

  select count(*)::integer into v_total
  from public.cases c
  join public.people p on p.id = c.person_id
  where c.condition_status = 'deceased_confirmed'
    and c.deleted_at is null
    and p.is_test_data = false;

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
  )
  select
    c.id,
    null,
    'portrait',
    'public-portraits',
    v_public_path,
    v_public_url,
    'imagen-conmemorativa-fallecidos.jpg',
    'image/jpeg',
    p_size_bytes
  from public.cases c
  join public.people p on p.id = c.person_id
  where c.condition_status = 'deceased_confirmed'
    and c.deleted_at is null
    and p.is_test_data = false
    and not exists (
      select 1
      from public.media_assets m
      where m.case_id = c.id
        and m.asset_type = 'portrait'
        and m.storage_bucket = 'public-portraits'
        and m.private_path = v_public_path
        and m.public_path = v_public_url
    );
  get diagnostics v_media_linked = row_count;

  select count(*)::integer into v_cards_configured
  from public.cases c
  join public.people p on p.id = c.person_id
  where c.condition_status = 'deceased_confirmed'
    and c.deleted_at is null
    and p.is_test_data = false
    and exists (
      select 1
      from public.media_assets m
      where m.case_id = c.id
        and m.asset_type = 'portrait'
        and m.storage_bucket = 'public-portraits'
        and m.private_path = v_public_path
        and m.public_path = v_public_url
    );

  if v_media_linked > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    select
      null,
      'deceased_memorial_portrait_applied',
      'case',
      c.id,
      jsonb_build_object(
        'actorType', 'service_role',
        'reason', v_reason,
        'assetSha256', substring(v_public_path from 'deceased-([a-f0-9]{64})\.jpg$')
      )
    from public.cases c
    join pg_temp.memorial_changed_cases changed on changed.case_id = c.id;
  end if;

  return jsonb_build_object(
    'totalConfirmedDeceased', v_total,
    'mediaLinked', v_media_linked,
    'cardsConfigured', v_cards_configured
  );
end;
$$;

revoke all on function public.apply_deceased_memorial_portrait(text,text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_deceased_memorial_portrait(text,text,integer,text)
  to service_role;

-- The view prefers a service-linked memorial asset for confirmed-deceased
-- cards. Other statuses retain the explicitly approved primary portrait. No
-- case status, authority field or primary path is mutated by this migration.
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
    and (
      (
        c.condition_status = 'deceased_confirmed'
        and m.private_path ~ '^memorial/deceased-[a-f0-9]{64}\.jpg$'
      )
      or (
        c.primary_public_photo_path is not null
        and m.private_path = c.primary_public_photo_path
      )
    )
  order by
    case when c.condition_status = 'deceased_confirmed'
      and m.private_path ~ '^memorial/deceased-[a-f0-9]{64}\.jpg$' then 0 else 1 end,
    m.created_at desc
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

alter function public.reports_debug_snapshot() rename to reports_debug_snapshot_v202608130003;
revoke all on function public.reports_debug_snapshot_v202608130003() from public, anon, authenticated;

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
  v_snapshot := public.reports_debug_snapshot_v202608130003();
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
      into v_last_migration;
  end if;

  return v_snapshot || jsonb_build_object(
    'schemaVersion', '202608130004',
    'lastMigrationApplied', v_last_migration,
    'rpcs', coalesce(v_snapshot -> 'rpcs', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'name', 'apply_deceased_memorial_portrait',
        'found', to_regprocedure('public.apply_deceased_memorial_portrait(text,text,integer,text)') is not null
      )
    )
  );
end;
$$;

revoke all on function public.reports_debug_snapshot() from public, anon, authenticated;
grant execute on function public.reports_debug_snapshot() to service_role;

notify pgrst, 'reload schema';
