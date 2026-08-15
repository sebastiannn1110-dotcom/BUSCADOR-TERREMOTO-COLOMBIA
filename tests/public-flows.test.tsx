import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseCard } from "@/components/case-card";
import { PhotoPlaceholder } from "@/components/photo-placeholder";
import type { CaseCard as CaseCardType } from "@/lib/types";
import ReportConfirmationPage, { metadata as reportConfirmationMetadata } from "@/app/reporte/confirmacion/page";

const { searchCases } = vi.hoisted(() => ({ searchCases: vi.fn() }));
vi.mock("@/lib/cases", () => ({
  PUBLIC_CASE_PAGE_SIZE: 48,
  searchCases
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: vi.fn() })
}));

import Home from "@/app/page";
import DeceasedPage from "@/app/fallecidos/page";

const item: CaseCardType = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "persona-prueba",
  full_name: "Persona de prueba",
  approximate_age: 40,
  is_minor: false,
  condition_status: "deceased_confirmed",
  verification_level: "authority_confirmed",
  urgency_level: "normal",
  last_seen_at: null,
  last_seen_location_public: "Lugar aproximado",
  reported_unit: "Unidad Pereira",
  primary_public_photo_url: null,
  approved_reports_count: 0,
  updated_at: "2026-08-12T12:00:00Z",
  is_test_data: false,
  public_source_label: "Medicina Legal",
  public_description: "Información tomada de las listas de Medicina Legal."
};

describe("flujos públicos", () => {
  beforeEach(() => {
    searchCases.mockReset();
    vi.unstubAllEnvs();
  });

  it("muestra las dos categorías principales en la home", async () => {
    searchCases.mockResolvedValue([]);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Desaparecidos");
    expect(html).toContain("Fallecidos confirmados");
    expect(html).toContain('href="/buscar?estado=missing"');
    expect(html).toContain('href="/fallecidos"');
  });

  it("renderiza el placeholder digno y su nombre accesible", () => {
    const html = renderToStaticMarkup(<PhotoPlaceholder />);
    expect(html).toContain("Foto no disponible");
    expect(html).toContain('aria-label="Foto no disponible para esta persona."');
  });

  it("muestra una card fallecida confirmada sin inventar foto", () => {
    const html = renderToStaticMarkup(<CaseCard item={item} />);
    expect(html).toContain("Foto no disponible");
    expect(html).toContain("Declarado muerto por Medicina Legal");
    expect(html).toContain("Información tomada de las listas de Medicina Legal");
    expect(html).toContain("Unidad básica / lugar reportado");
    expect(html).toContain("Unidad Pereira");
    expect(html).toMatch(/Confirmado por autoridad/i);
    expect(html).toContain("Tengo una corrección o información");
    expect(html).toContain("?tipo=correction");
    expect(html).not.toContain("<img");
  });

  it("usa el retrato público actual en cards de inicio, búsqueda y fallecidos", async () => {
    const withPortrait = { ...item, primary_public_photo_url: "data:image/jpeg;base64,/9j/2Q==" };
    const cardHtml = renderToStaticMarkup(<CaseCard item={withPortrait} />);
    expect(cardHtml).toContain("Foto publicada de Persona de prueba");
    expect(cardHtml).toContain("<img");

    searchCases.mockResolvedValue([withPortrait]);
    expect(renderToStaticMarkup(await Home())).toContain("Foto publicada de Persona de prueba");
    expect(renderToStaticMarkup(await DeceasedPage({ searchParams: Promise.resolve({}) })))
      .toContain("Foto publicada de Persona de prueba");
  });

  it("filtra fallecidos por confirmación oficial antes de renderizar", async () => {
    searchCases.mockResolvedValue([
      item,
      { ...item, id: "22222222-2222-4222-8222-222222222222", slug: "sin-confirmar", full_name: "Registro sin confirmar", verification_level: "unverified" },
      { ...item, id: "33333333-3333-4333-8333-333333333333", slug: "caso-abierto", full_name: "Caso abierto", condition_status: "missing" }
    ]);
    const html = renderToStaticMarkup(await DeceasedPage({ searchParams: Promise.resolve({}) }));
    expect(searchCases).toHaveBeenCalledWith("", { status: "deceased_confirmed" });
    expect(html).toContain("Persona de prueba");
    expect(html).not.toContain("Registro sin confirmar");
    expect(html).not.toContain("Caso abierto");
  });

  it("busca fallecidos por nombre usando la consulta pública de Supabase", async () => {
    searchCases.mockResolvedValue([item]);
    const html = renderToStaticMarkup(await DeceasedPage({
      searchParams: Promise.resolve({ q: "Persona de prueba" })
    }));
    expect(searchCases).toHaveBeenCalledWith("Persona de prueba", { status: "deceased_confirmed" });
    expect(html).toContain('action="/fallecidos"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="Persona de prueba"');
    expect(html).toContain("Personas identificadas oficialmente. Información tomada de las listas de Medicina Legal u otra fuente autorizada.");
  });

  it("pagina el listado de fallecidos sin presentar el subconjunto como total", async () => {
    searchCases.mockResolvedValue(Array.from({ length: 48 }, (_, index) => ({
      ...item,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      slug: `persona-ficticia-${index}`,
      full_name: `Persona Ficticia ${index}`
    })));
    const html = renderToStaticMarkup(await DeceasedPage({ searchParams: Promise.resolve({ pagina: "2" }) }));
    expect(searchCases).toHaveBeenCalledWith("", { status: "deceased_confirmed", page: "2" });
    expect(html).toContain("48 registros en la página 2");
    expect(html).toContain('href="/fallecidos"');
    expect(html).toContain('href="/fallecidos?pagina=3"');
  });

  it("oculta tracking, URL y controles para compartir en la confirmación", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const html = renderToStaticMarkup(<ReportConfirmationPage />);
    expect(html).toContain("Reporte recibido");
    expect(html).toContain("Recibimos tu reporte. Todavía no está publicado.");
    expect(html).toContain("Si el equipo necesita más información, se comunicará al número que dejaste en el formulario.");
    expect(html).toContain("Volver al inicio");
    expect(html).toContain("Reportar otra persona");
    expect(html).not.toContain("EN-PRUEBA-123");
    expect(html).not.toContain("EN-");
    expect(html).not.toContain("localhost");
    expect(html).not.toContain("Copiar enlace");
  });

  it("marca el recibo público como noindex y nofollow", () => {
    expect(reportConfirmationMetadata).toMatchObject({
      robots: { index: false, follow: false }
    });
  });
});
