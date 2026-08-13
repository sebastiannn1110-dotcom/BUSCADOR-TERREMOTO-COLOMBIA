import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaseCard } from "@/lib/types";

const { getCase } = vi.hoisted(() => ({ getCase: vi.fn() }));
vi.mock("@/lib/cases", () => ({ getCase }));

import PersonPage from "@/app/persona/[slug]/page";

describe("página pública del caso", () => {
  it("muestra solo el avistamiento revisado sin datos privados", async () => {
    const item = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "persona-prueba",
      full_name: "Persona de prueba",
      approximate_age: null,
      is_minor: false,
      condition_status: "missing",
      verification_level: "moderator_reviewed",
      urgency_level: "normal",
      last_seen_at: null,
      last_seen_location_public: "Sector público",
      primary_public_photo_url: null,
      approved_reports_count: 1,
      approved_sightings_count: 1,
      latest_approved_sighting_location: "Sector aproximado",
      updated_at: "2026-08-12T12:00:00Z",
      is_test_data: true,
      approved_sightings: [{ id: "one", event_at: null, location_public: "Sector aproximado", description: "Descripción pública revisada" }],
      reporter_phone: "3001112233",
      pending_description: "NO-DEBE-APARECER"
    } as CaseCard & { reporter_phone: string; pending_description: string };
    getCase.mockResolvedValue(item);
    const page = await PersonPage({ params: Promise.resolve({ slug: item.slug }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Posibles avistamientos");
    expect(html).toContain("Descripción pública revisada");
    expect(html).toContain("Revisado por el equipo");
    expect(html).toContain("Último posible avistamiento");
    expect(html).toContain("Tengo información / La vi");
    expect(html).toContain("?tipo=correction");
    expect(html).not.toContain("3001112233");
    expect(html).not.toContain("NO-DEBE-APARECER");
  });

  it("muestra el vacío exacto cuando no hay avistamientos aprobados", async () => {
    getCase.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      slug: "persona-sin-avistamientos",
      full_name: "Persona sin avistamientos",
      approximate_age: null,
      is_minor: false,
      condition_status: "missing",
      verification_level: "moderator_reviewed",
      urgency_level: "normal",
      last_seen_at: null,
      last_seen_location_public: null,
      primary_public_photo_url: null,
      approved_reports_count: 0,
      approved_sightings: [],
      updated_at: "2026-08-12T12:00:00Z",
      is_test_data: false
    });
    const page = await PersonPage({ params: Promise.resolve({ slug: "persona-sin-avistamientos" }) });
    expect(renderToStaticMarkup(page)).toContain("Todavía no hay posibles avistamientos revisados.");
  });
});
