import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ upload, remove }));

vi.mock("@/lib/supabase/server", () => ({
  adminSupabase: () => ({ rpc, storage: { from } })
}));

import { POST } from "@/app/api/reports/route";

const missingPerson = {
  fullName: "Persona de prueba",
  approximateAge: 30,
  identificationDescription: "Chaqueta azul y una cicatriz pequeña.",
  lastSeenDate: "2026-08-11",
  lastSeenTime: "10:30",
  location: "Lugar aproximado de prueba",
  reporterName: "Quien reporta",
  phone: "3000000000",
  consent: true
};

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }));
}

function oversizedMultipartRequest(contentLength?: string) {
  const headers: Record<string, string> = {
    "content-type": "multipart/form-data; boundary=reports-boundary",
    "x-forwarded-for": "203.0.113.10"
  };
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  return new NextRequest("http://localhost/api/reports", {
    method: "POST",
    headers,
    body: new Uint8Array(9 * 1024 * 1024 + 1)
  });
}

describe("POST /api/reports", () => {
  beforeEach(() => {
    rpc.mockReset();
    upload.mockReset();
    remove.mockReset();
    from.mockClear();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CAPTCHA_PROVIDER", "");
    vi.stubEnv("CAPTCHA_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_SITE_KEY", "");
    vi.stubEnv("IP_HASH_SECRET", "");
  });

  it("rechaza JSON inválido sin tocar la base", async () => {
    const response = await post("{");
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["sin Content-Length", undefined],
    ["con Content-Length forjado", "128"]
  ])("rechaza multipart mayor al límite %s antes de parsearlo", async (_label, contentLength) => {
    const request = oversizedMultipartRequest(contentLength);
    expect(request.headers.get("content-length")).toBe(contentLength ?? null);

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect((await response.json()).message).toMatch(/demasiado grande/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("valida el celular antes de enviar el reporte", async () => {
    const response = await post({ ...missingPerson, phone: "" });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["una fecha inexistente", { lastSeenDate: "2026-02-31" }],
    ["un 29 de febrero fuera de año bisiesto", { lastSeenDate: "2026-02-29" }],
    ["una hora fuera del reloj de 24 horas", { lastSeenTime: "99:99" }]
  ])("rechaza %s antes de consultar Supabase", async (_label, override) => {
    const response = await post({ ...missingPerson, ...override });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["eventDate", { eventDate: "2026-04-31" }],
    ["eventTime", { eventDate: "2026-08-12", eventTime: "24:00" }],
    ["eventAt con calendario imposible", { eventAt: "2026-02-31T10:30" }],
    ["eventAt con hora imposible", { eventAt: "2026-08-12T99:99" }],
    ["eventAt con offset imposible", { eventAt: "2026-08-12T10:30+14:30" }]
  ])("rechaza $0 inválido antes de consultar Supabase", async (_label, dateFields) => {
    const response = await post({
      caseId: "11111111-1111-4111-8111-111111111111",
      reportType: "sighting",
      location: "Sector aproximado",
      description: "Información ficticia suficientemente detallada.",
      consent: true,
      ...dateFields
    });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("acepta fechas reales, incluidos años bisiestos y fechas futuras", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-FECHA-VALIDA" }, error: null });
    const response = await post({
      ...missingPerson,
      lastSeenDate: "2096-02-29",
      lastSeenTime: "23:59"
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_payload.lastSeenAt).toBe("2096-02-29T23:59:00-05:00");
  });

  it("acepta eventAt ISO válido y conserva la fecha futura para moderación", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-EVENTO-VALIDO" }, error: null });
    const response = await post({
      caseId: "11111111-1111-4111-8111-111111111111",
      reportType: "sighting",
      eventAt: "2096-02-29T23:59",
      location: "Sector aproximado",
      description: "Información ficticia suficientemente detallada.",
      consent: true
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_payload.eventAt).toBe("2096-02-29T23:59:00-05:00");
  });

  it("usa únicamente el RPC seguro y no devuelve el código interno", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-PRUEBA-123" }, error: null });
    const response = await post(missingPerson);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ received: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("submit_public_report");
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({
      kind: "missing_person",
      fullName: missingPerson.fullName,
      features: missingPerson.identificationDescription,
      isMinor: false,
      alias: null,
      clothing: null,
      circumstances: null,
      email: null,
      relationship: null,
      consentAt: expect.any(String),
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  it.each([
    { age: 17, expected: true },
    { age: 18, expected: false },
    { age: undefined, expected: true }
  ])("deriva protección de menor con edad $age", async ({ age, expected }) => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-EDAD-SEGURA" }, error: null });
    const response = await post({ ...missingPerson, approximateAge: age });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_payload.isMinor).toBe(expected);
  });

  it("ignora campos de contacto retirados aunque un cliente antiguo los envíe", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-CAMPOS-SEGUROS" }, error: null });
    const response = await post({
      ...missingPerson,
      alias: "No debe persistirse",
      email: "privado@example.invalid",
      relationship: "Dato retirado",
      circumstances: "Historia retirada"
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({
      alias: null,
      email: null,
      relationship: null,
      circumstances: null
    });
  });

  it("envía un reporte sin foto sin tocar Storage", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-SIN-FOTO" }, error: null });
    const response = await post(missingPerson);
    expect(response.status).toBe(201);
    expect(from).not.toHaveBeenCalled();
  });

  it("sube una foto privada y envía sus metadatos al RPC", async () => {
    upload.mockResolvedValue({ data: { path: "private" }, error: null });
    rpc.mockResolvedValue({ data: { tracking_code: "EN-CON-FOTO" }, error: null });
    const form = new FormData();
    Object.entries(missingPerson).forEach(([key, value]) => form.set(key, String(value)));
    form.set("photo", new File([new Uint8Array([1, 2, 3])], "persona.jpg", { type: "image/jpeg" }));
    const response = await POST(new NextRequest("http://localhost/api/reports", { method: "POST", headers: { "x-forwarded-for": "203.0.113.10" }, body: form }));
    expect(response.status).toBe(201);
    expect(from).toHaveBeenCalledWith("report-evidence");
    expect(upload).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({ photoMimeType: "image/jpeg", photoOriginalName: "persona.jpg", photoSize: 3 });
  });

  it("crea información como reporte pendiente sin aceptar un estado público", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-AVISTAMIENTO" }, error: null });
    const response = await post({
      caseId: "11111111-1111-4111-8111-111111111111",
      reportType: "sighting",
      reportContext: "sighting_alive",
      eventDate: "2026-08-12",
      location: "Sector aproximado",
      description: "La vi caminando cerca de un parque.",
      consent: true,
      condition_status: "deceased_confirmed"
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({
      kind: "case_information",
      reportType: "sighting",
      reportContext: "sighting_alive",
      reporterName: null,
      email: null,
      relationship: null,
      consentAt: expect.any(String)
    });
    expect(rpc.mock.calls[0][1].p_payload).not.toHaveProperty("condition_status");
  });

  it("exige lugar para los dos tipos de avistamiento", async () => {
    const response = await post({
      caseId: "11111111-1111-4111-8111-111111111111",
      reportType: "sighting",
      reportContext: "sighting_alive",
      description: "Información ficticia suficientemente detallada.",
      consent: true
    });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("exige teléfono cuando el avistamiento es en un punto de atención", async () => {
    const response = await post({
      caseId: "11111111-1111-4111-8111-111111111111",
      reportType: "sighting",
      reportContext: "sighting_care",
      location: "Refugio aproximado",
      description: "Información ficticia suficientemente detallada.",
      consent: true
    });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("envía el contexto de atención y solo el teléfono privado", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-ATENCION" }, error: null });
    const response = await post({
      caseId: "11111111-1111-4111-8111-111111111111",
      reportType: "sighting",
      reportContext: "sighting_care",
      location: "Refugio aproximado",
      description: "Información ficticia suficientemente detallada.",
      phone: "3000000000",
      reporterName: "Debe ignorarse",
      email: "debe-ignorarse@example.invalid",
      relationship: "Debe ignorarse",
      consent: true
    });
    expect(response.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({
      reportType: "sighting",
      reportContext: "sighting_care",
      phone: "3000000000",
      reporterName: null,
      email: null,
      relationship: null
    });
  });

  it("permite el envío con las protecciones de servidor cuando CAPTCHA no está configurado", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-SIN-CAPTCHA" }, error: null });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    const response = await post(missingPerson);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ received: true });
  });

  it("no bloquea los reportes con una configuración CAPTCHA parcial", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-CAPTCHA-PARCIAL" }, error: null });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");

    const response = await post(missingPerson);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ received: true });
  });

  it("informa el límite de envíos sin revelar datos internos", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    const response = await post(missingPerson);
    expect(response.status).toBe(429);
    expect((await response.json()).message).toMatch(/varios reportes/i);
  });

  it("registra metadatos seguros de Supabase y correlaciona el 500", async () => {
    const databaseError = {
      name: "PostgrestError",
      message: "column urgency_level is of type urgency_level but expression is of type text",
      code: "42804",
      details: "Failing row contains (Persona, 3001234567, persona@example.com)",
      hint: "Rewrite or cast the expression",
      constraint: "cases_urgency_level_check",
      table: "cases",
      column: "urgency_level"
    };
    rpc.mockResolvedValue({ data: null, error: databaseError });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await post(missingPerson);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(errorLog).toHaveBeenCalledWith(
      "[REPORTS] Supabase query failed",
      expect.stringContaining('"code":"42804"')
    );
    expect(errorLog.mock.calls.flat().join(" ")).toContain('"table":"cases"');
    expect(errorLog.mock.calls.flat().join(" ")).toContain('"column":"urgency_level"');
    expect(errorLog.mock.calls.flat().join(" ")).toContain('"details":"[REDACTED]"');
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("3001234567");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("persona@example.com");
    errorLog.mockRestore();
  });
});
