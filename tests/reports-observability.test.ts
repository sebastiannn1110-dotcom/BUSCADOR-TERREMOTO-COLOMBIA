import { describe, expect, it, vi } from "vitest";
import { reportError, reportsLog } from "@/lib/reports-observability";

describe("observabilidad segura de reportes", () => {
  it("conserva metadatos PostgreSQL y redacta filas/contactos", () => {
    const diagnostic = reportError({
      name: "PostgrestError",
      message: "duplicate value for persona@example.com",
      code: "23505",
      details: "Failing row contains (Reportante, 3001234567, persona@example.com)",
      hint: "Revisa la restricción",
      constraint: "reporter_contacts_phone_key",
      table: "reporter_contacts",
      column: "phone"
    });

    expect(diagnostic).toMatchObject({
      code: "23505",
      details: "[REDACTED_DATABASE_DETAILS]",
      table: "reporter_contacts",
      column: "phone"
    });
    expect(JSON.stringify(diagnostic)).not.toContain("3001234567");
    expect(JSON.stringify(diagnostic)).not.toContain("persona@example.com");
  });

  it("redacta valores sensibles antes de escribir el log", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    reportsLog("info", "Prueba", {
      phone: "3001234567",
      message: "Contacto persona@example.com",
      token: "token-privado"
    });
    const output = info.mock.calls.flat().join(" ");
    expect(output).not.toContain("3001234567");
    expect(output).not.toContain("persona@example.com");
    expect(output).not.toContain("token-privado");
    info.mockRestore();
  });

  it("conserva los identificadores de correlación y marcas de tiempo", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const requestId = "11111111-1111-4111-8111-111111111111";
    reportsLog("info", "Prueba", { requestId });
    const output = info.mock.calls.flat().join(" ");
    expect(output).toContain(requestId);
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
    info.mockRestore();
  });
});
