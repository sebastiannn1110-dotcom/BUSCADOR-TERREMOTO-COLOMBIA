import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSheet } = vi.hoisted(() => ({ readSheet: vi.fn() }));
vi.mock("read-excel-file/node", () => ({ readSheet }));

import {
  applyImportDefaults,
  parsePersonImportFile,
  parsePersonImportText
} from "@/lib/person-import";

describe("archivos de importación de personas", () => {
  beforeEach(() => readSheet.mockReset());

  it("acepta CSV de desaparecidos y conserva municipio/departamento vacíos", () => {
    const rows = applyImportDefaults(parsePersonImportText([
      "N°,Nombres,Departamento Desaparición,Municipio Desaparición",
      "1,A B,Antioquia,",
      "2,Persona Ficticia,,"
    ].join("\n"), "missing"), "missing", {
      sourceName: "Lista aportada por administrador",
      sourceReference: "Lista ficticia 2026-08-15",
      publicDescription: "Persona reportada en una lista ficticia."
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source_row: "1",
      full_name: "A B",
      department_disappearance: "Antioquia",
      municipality_disappearance: ""
    });
    expect(rows[1]).toMatchObject({
      department_disappearance: "",
      municipality_disappearance: ""
    });
    expect(rows[0]).not.toHaveProperty("approximate_age");
    expect(rows[0]).not.toHaveProperty("gender");
  });

  it("acepta XLSX de desaparecidos mediante la misma normalización", async () => {
    readSheet.mockResolvedValue([
      ["N°", "Nombres", "Departamento Desaparición", "Municipio Desaparición"],
      [7, "Persona XLSX Ficticia", "Caldas", null]
    ]);
    const file = new File([new Uint8Array([80, 75, 3, 4])], "personas.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const rows = await parsePersonImportFile(file, "missing");
    expect(readSheet).toHaveBeenCalledOnce();
    expect(rows[0]).toMatchObject({ source_row: "7", full_name: "Persona XLSX Ficticia", municipality_disappearance: "" });
  });

  it("acepta fallecidos sin edad, género, unidad, lugar ni foto", () => {
    const rows = applyImportDefaults(parsePersonImportText([
      "source_row,reported_unit,full_name,gender,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed",
      "1,,Persona Fallecida Ficticia,,,,Referencia oficial ficticia,,,"
    ].join("\n"), "deceased"), "deceased", {
      sourceName: "Medicina Legal",
      sourceReference: "Referencia oficial predeterminada",
      publicDescription: "Información tomada de una lista oficial ficticia."
    });
    expect(rows[0]).toMatchObject({
      gender: "",
      approximate_age: "",
      reported_unit: "",
      last_seen_location_public: "",
      source_name: "Medicina Legal",
      source_reference: "Referencia oficial ficticia"
    });
    expect(rows[0]).not.toHaveProperty("primary_public_photo_path");
  });

  it("rechaza PII dentro de campos destinados a publicación", () => {
    expect(() => parsePersonImportText([
      "full_name,department_disappearance,municipality_disappearance",
      "Persona Ficticia,Escribir a privado@example.invalid,"
    ].join("\n"), "missing")).toThrow(/teléfono o correo/i);
  });
});
