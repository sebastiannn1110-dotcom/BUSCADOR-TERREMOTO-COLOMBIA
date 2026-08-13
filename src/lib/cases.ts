import { publicSupabase } from "./supabase/server";
import { hasObviousContactData } from "./request-security";
import { decodePublicCaseSlug } from "./public-case-route";
import type { CaseCard, ConditionStatus, Sighting, VerificationLevel } from "./types";

const conditionStatuses = new Set<ConditionStatus>([
  "missing",
  "possibly_trapped",
  "located_alive",
  "reunited",
  "deceased_confirmed",
  "closed"
]);
const verificationLevels = new Set<VerificationLevel>(["unverified", "moderator_reviewed", "authority_confirmed"]);
export const PUBLIC_CASE_PAGE_SIZE = 48;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function safePublicText(value: unknown): string | null {
  const candidate = text(value);
  return candidate && !hasObviousContactData(candidate) ? candidate : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function publicSighting(value: unknown): Sighting | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const description = safePublicText(source.description);
  if (!id || !description) return null;
  return {
    id,
    event_at: text(source.event_at),
    location_public: safePublicText(source.location_public),
    description,
    reviewed_at: text(source.reviewed_at)
  };
}

/**
 * Runtime allow-list for every public response. If a database projection
 * changes unexpectedly, private fields are still discarded before they can
 * reach public HTML or JSON.
 */
export function sanitizePublicCase(value: unknown): CaseCard | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const slug = text(source.slug);
  const fullName = safePublicText(source.full_name);
  const condition = text(source.condition_status);
  const verification = text(source.verification_level);
  if (!id || !slug || !fullName || !condition || !conditionStatuses.has(condition as ConditionStatus)
    || !verification || !verificationLevels.has(verification as VerificationLevel)) return null;

  const rawSightings = Array.isArray(source.approved_sightings)
    ? source.approved_sightings
    : Array.isArray(source.sightings) ? source.sightings : [];
  const approvedSightings = rawSightings.map(publicSighting).filter((item): item is Sighting => item !== null);
  const approvedCount = count(source.approved_sightings_count ?? source.approved_reports_count);

  return {
    id,
    slug,
    full_name: fullName,
    approximate_age: numberOrNull(source.approximate_age),
    is_minor: source.is_minor === true,
    condition_status: condition as ConditionStatus,
    verification_level: verification as VerificationLevel,
    urgency_level: text(source.urgency_level) || "normal",
    last_seen_at: text(source.last_seen_at),
    last_seen_location_public: safePublicText(source.last_seen_location_public),
    reported_unit: safePublicText(source.reported_unit),
    primary_public_photo_url: text(source.primary_public_photo_url),
    approved_reports_count: approvedCount,
    approved_sightings_count: approvedCount,
    approved_sightings: approvedSightings,
    sightings: approvedSightings,
    updated_at: text(source.updated_at) || new Date(0).toISOString(),
    is_test_data: source.is_test_data === true,
    public_description: safePublicText(source.public_description),
    public_source_label: safePublicText(source.public_source_label),
    latest_approved_sighting_location: safePublicText(source.latest_approved_sighting_location)
  };
}

export async function searchCases(query = "", filters: Record<string, string> = {}): Promise<CaseCard[]> {
  const db = publicSupabase();
  if (!db) return [];
  const status = conditionStatuses.has(filters.status as ConditionStatus) ? filters.status : null;
  const requestedPage = Number(filters.page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 10_000)
    : 1;
  const { data, error } = await db.rpc("search_public_people", {
    query_text: query,
    status_filter: status,
    min_age: filters.minAge ? Number(filters.minAge) : null,
    max_age: filters.maxAge ? Number(filters.maxAge) : null,
    page_limit: PUBLIC_CASE_PAGE_SIZE,
    page_offset: (page - 1) * PUBLIC_CASE_PAGE_SIZE
  });
  if (error) throw new Error("No pudimos cargar los casos públicos.");
  return Array.isArray(data)
    ? data.map(sanitizePublicCase).filter((item): item is CaseCard => item !== null)
    : [];
}

export async function getCase(slug: string): Promise<CaseCard | null> {
  const db = publicSupabase();
  if (!db) return null;
  const { data, error } = await db.rpc("get_public_case", { case_slug: decodePublicCaseSlug(slug) });
  if (error) return null;
  return sanitizePublicCase(Array.isArray(data) ? data[0] : null);
}
