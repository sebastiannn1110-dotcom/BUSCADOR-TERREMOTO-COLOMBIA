import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ publicSupabase: () => ({ rpc }) }));

import { getCase, sanitizePublicCase, searchCases } from "@/lib/cases";
import { publicCasePath } from "@/lib/public-case-route";
import { GET } from "@/app/api/search/route";

const databaseRow = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "persona-publica",
  full_name: "Persona Pública Ficticia",
  approximate_age: 31,
  is_minor: false,
  condition_status: "missing",
  verification_level: "moderator_reviewed",
  urgency_level: "normal",
  last_seen_at: null,
  last_seen_location_public: "Sector público aproximado",
  reported_unit: "Unidad básica pública",
  primary_public_photo_url: null,
  approved_reports_count: 1,
  approved_sightings_count: 1,
  approved_sightings: [{
    id: "22222222-2222-4222-8222-222222222222",
    event_at: null,
    location_public: "Parque aproximado",
    description: "Descripción pública revisada.",
    reporter_phone: "3001112233"
  }],
  latest_approved_sighting_location: "Parque aproximado",
  public_source_label: null,
  updated_at: "2026-08-13T12:00:00Z",
  is_test_data: false,
  phone: "3009998877",
  email: "privado@example.invalid",
  reporter_name: "Nombre privado",
  authority_reference_private: "Referencia privada",
  location_private: "Dirección exacta privada",
  private_storage_path: "report-evidence/private.jpg"
};

describe("proyección pública defensiva", () => {
  beforeEach(() => rpc.mockReset());

  it("descarta PII y campos internos incluso si llegan inesperadamente", () => {
    const safe = sanitizePublicCase(databaseRow);
    const json = JSON.stringify(safe);
    expect(safe?.full_name).toBe("Persona Pública Ficticia");
    expect(safe?.reported_unit).toBe("Unidad básica pública");
    expect(safe?.approved_sightings?.[0]).toEqual(expect.objectContaining({ location_public: "Parque aproximado" }));
    expect(json).not.toContain("3009998877");
    expect(json).not.toContain("privado@example.invalid");
    expect(json).not.toContain("Nombre privado");
    expect(json).not.toContain("Dirección exacta privada");
    expect(json).not.toContain("report-evidence");
    expect(json).not.toContain("3001112233");
  });

  it("descarta contacto incrustado dentro de campos con nombre público", () => {
    const unsafe = sanitizePublicCase({
      ...databaseRow,
      full_name: "Persona Ficticia",
      public_description: "Información útil; llamar al 300 123 4567",
      last_seen_location_public: "Escribir a privado@example.invalid",
      reported_unit: "Llamar al 300 555 6789",
      latest_approved_sighting_location: "Teléfono +57 300 555 1234",
      approved_sightings: [{
        id: "22222222-2222-4222-8222-222222222222",
        event_at: null,
        location_public: "Correo aviso@example.invalid",
        description: "Descripción con 300 111 2233",
        reviewed_at: null
      }]
    });

    expect(unsafe).not.toBeNull();
    expect(unsafe?.public_description).toBeNull();
    expect(unsafe?.last_seen_location_public).toBeNull();
    expect(unsafe?.reported_unit).toBeNull();
    expect(unsafe?.latest_approved_sighting_location).toBeNull();
    expect(unsafe?.approved_sightings).toEqual([]);
  });

  it("consulta Supabase aunque una bandera de demo esté activa", async () => {
    vi.stubEnv("ENABLE_TEST_DATA", "true");
    rpc.mockResolvedValue({ data: [databaseRow], error: null });
    const result = await searchCases("Persona", { status: "missing" });
    expect(result).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("search_public_people", expect.objectContaining({ status_filter: "missing" }));
  });

  it("decodifica slugs oficiales con espacios antes de consultar la ficha", async () => {
    rpc.mockResolvedValue({ data: [{ ...databaseRow, slug: "fernando alonso gonzalez-db2b9d84ba3e" }], error: null });

    const result = await getCase("fernando%20alonso%20gonzalez-db2b9d84ba3e");

    expect(result?.slug).toBe("fernando alonso gonzalez-db2b9d84ba3e");
    expect(rpc).toHaveBeenCalledWith("get_public_case", {
      case_slug: "fernando alonso gonzalez-db2b9d84ba3e"
    });
    expect(publicCasePath(result!.slug)).toBe("/persona/fernando%20alonso%20gonzalez-db2b9d84ba3e");
  });

  it("la API soporta estado y devuelve únicamente la lista segura", async () => {
    rpc.mockResolvedValue({ data: [databaseRow], error: null });
    const response = await GET(new NextRequest("http://localhost/api/search?q=Persona&estado=missing"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("search_public_people", expect.objectContaining({ status_filter: "missing" }));
    const json = JSON.stringify(body);
    expect(json).not.toContain("3009998877");
    expect(json).not.toContain("privado@example.invalid");
    expect(json).not.toContain("authority_reference_private");
    expect(json).not.toContain("private_storage_path");
  });

  it("pagina la búsqueda pública sin ampliar la allowlist", async () => {
    rpc.mockResolvedValue({ data: [databaseRow], error: null });
    const response = await GET(new NextRequest("http://localhost/api/search?estado=missing&pagina=3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ page: 3, hasMore: false });
    expect(rpc).toHaveBeenCalledWith("search_public_people", expect.objectContaining({
      status_filter: "missing",
      page_limit: 48,
      page_offset: 96
    }));
  });
});
