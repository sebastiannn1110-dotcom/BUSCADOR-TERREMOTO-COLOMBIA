-- Keep the reviewed per-person portrait behavior for active missing cases, while
-- preferring the audited generic memorial portrait for confirmed-deceased cards.

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
        and m.moderation_status = 'approved'
        and m.retired_at is null
      )
      or (
        c.primary_public_photo_path is not null
        and m.private_path = c.primary_public_photo_path
      )
    )
  order by
    case when c.condition_status = 'deceased_confirmed'
      and m.private_path ~ '^memorial/deceased-[a-f0-9]{64}\.jpg$'
      and m.moderation_status = 'approved'
      and m.retired_at is null then 0 else 1 end,
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
