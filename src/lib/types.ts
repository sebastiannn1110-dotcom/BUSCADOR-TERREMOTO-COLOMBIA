export type ConditionStatus = "missing" | "possibly_trapped" | "located_alive" | "reunited" | "deceased_confirmed" | "closed";
export type VerificationLevel = "unverified" | "moderator_reviewed" | "authority_confirmed";
export type ReportType = "sighting" | "possible_trapped" | "possible_deceased" | "correction" | "other_information";
export type CaseCard = { id: string; slug: string; full_name: string; approximate_age: number | null; is_minor: boolean; condition_status: ConditionStatus; verification_level: VerificationLevel; urgency_level: string; last_seen_at: string | null; last_seen_location_public: string | null; primary_public_photo_url: string | null; approved_reports_count: number; updated_at: string; is_test_data: boolean; public_description?: string | null; distinguishing_features?: string | null; clothing?: string | null; sightings?: Sighting[] };
export type Sighting = { id: string; event_at: string | null; location_public: string | null; description: string };
