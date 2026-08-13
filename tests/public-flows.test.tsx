import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseCard } from "@/components/case-card";
import { PhotoPlaceholder } from "@/components/photo-placeholder";
import type { CaseCard as CaseCardType } from "@/lib/types";
import ReportConfirmationPage from "@/app/reporte/confirmacion/[trackingCode]/page";

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
  primary_public_photo_url: null,
  approved_reports_count: 0,
  updated_at: "2026-08-12T12:00:00Z",
  is_test_data: true
};

describe("flujos públicos", () => {
  it("renderiza el placeholder digno y su nombre accesible", () => {
    const html = renderToStaticMarkup(<PhotoPlaceholder />);
    expect(html).toContain("Foto no disponible");
    expect(html).toContain('aria-label="Foto no disponible para esta persona."');
  });

  it("muestra una card fallecida confirmada sin inventar foto", () => {
    const html = renderToStaticMarkup(<CaseCard item={item} />);
    expect(html).toContain("Foto no disponible");
    expect(html).toMatch(/Fallecimiento confirmado/i);
    expect(html).toMatch(/Confirmado por autoridad/i);
    expect(html).not.toContain("<img");
  });

  it("muestra tracking, URL y controles de confirmación", async () => {
    const page = await ReportConfirmationPage({ params: Promise.resolve({ trackingCode: "EN-PRUEBA-123" }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("EN-PRUEBA-123");
    expect(html).toContain("/reporte/confirmacion/EN-PRUEBA-123");
    expect(html).toContain("Copiar enlace");
    expect(html).toContain("Volver al inicio");
  });
});
