import { demoCases } from "./demo-data";
import { normalizeName } from "./normalize";
import { publicSupabase } from "./supabase/server";
import type { CaseCard } from "./types";
const demoEnabled = () => process.env.ENABLE_TEST_DATA === "true";
export async function searchCases(query = "", filters: Record<string, string> = {}) : Promise<CaseCard[]> {
  if (demoEnabled()) { const needle = normalizeName(query); return demoCases.filter((c) => !needle || normalizeName(`${c.full_name} ${c.last_seen_location_public} ${c.public_description}`).includes(needle) || c.full_name.split(" ").some((p) => normalizeName(p).startsWith(needle))).filter((c) => !filters.status || c.condition_status === filters.status); }
  const db = publicSupabase();
  if (db) { const { data, error } = await db.rpc("search_public_people", { query_text: query, status_filter: filters.status || null, min_age: filters.minAge ? Number(filters.minAge) : null, max_age: filters.maxAge ? Number(filters.maxAge) : null, page_limit: 48, page_offset: 0 }); if (error) throw new Error("No pudimos cargar los casos públicos."); return data as CaseCard[]; }
  return [];
}
export async function getCase(slug: string): Promise<CaseCard | null> { if (demoEnabled()) return demoCases.find((c) => c.slug === slug) ?? null; const db = publicSupabase(); if (db) { const { data, error } = await db.rpc("get_public_case", { case_slug: slug }); if (error) return null; return (data?.[0] ?? null) as CaseCard | null; } return null; }
