import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { officialImportHeaders, parseOfficialCsv } from "@/lib/official-import";

describe("importación oficial", () => {
  it("acepta un fallecido oficial sin foto y conserva solo las columnas permitidas", () => {
    const csv = `${officialImportHeaders.join(",")}\nPersona Oficial,42,Femenino,Medicina Legal,Comunicado 04,Descripción pública,Lugar público,2026-08-12`;
    const rows = parseOfficialCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_name).toBe("Medicina Legal");
    expect(rows[0]).not.toHaveProperty("primary_public_photo_path");
    expect(rows[0]).not.toHaveProperty("phone");
  });

  it("rechaza una fuente no oficial", () => {
    const csv = `${officialImportHeaders.join(",")}\nPersona No Oficial,42,,Red social,,,,`;
    expect(() => parseOfficialCsv(csv)).toThrow(/Medicina Legal/i);
  });

  it("la migración publica únicamente avistamientos aprobados y no proyecta contactos", () => {
    const sql = readFileSync("supabase/migrations/202608120004_public_flows_and_official_imports.sql", "utf8");
    const publicView = sql.slice(sql.indexOf("create or replace view public.public_case_cards"), sql.indexOf("create or replace function public.get_pending_case_reports"));
    expect(publicView).toContain("r.moderation_status = 'approved'");
    expect(publicView).toContain("r.report_type = 'sighting'");
    expect(publicView).not.toContain("reporter_contacts");
    expect(publicView).not.toContain("location_private");
  });

  it("la importación aplica confirmación oficial, auditoría e historial sin foto", () => {
    const sql = readFileSync("supabase/migrations/202608120004_public_flows_and_official_imports.sql", "utf8");
    expect(sql).toContain("'published', 'deceased_confirmed', 'authority_confirmed', 'normal'");
    expect(sql).toContain("insert into public.status_history");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("'official_deceased_import'");
    expect(sql).toContain("primary_public_photo_path");
    expect(sql).toContain("v_confirmed_at, now(), null");
  });
});
