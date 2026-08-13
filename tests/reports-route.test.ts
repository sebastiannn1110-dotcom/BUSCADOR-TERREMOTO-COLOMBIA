import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  adminSupabase: () => ({ rpc })
}));

import { POST } from "@/app/api/reports/route";

const missingPerson = {
  fullName: "Persona de prueba",
  lastSeenDate: "2026-08-11",
  lastSeenTime: "10:30",
  location: "Lugar aproximado de prueba",
  reporterName: "Quien reporta",
  phone: "3000000000"
};

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }));
}

describe("POST /api/reports", () => {
  beforeEach(() => {
    rpc.mockReset();
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

  it("valida el celular antes de enviar el reporte", async () => {
    const response = await post({ ...missingPerson, phone: "" });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("usa únicamente el RPC seguro y devuelve el código", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-PRUEBA-123" }, error: null });
    const response = await post(missingPerson);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ trackingCode: "EN-PRUEBA-123" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("submit_public_report");
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({
      kind: "missing_person",
      fullName: missingPerson.fullName,
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  it("permite el envío con las protecciones de servidor cuando CAPTCHA no está configurado", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-SIN-CAPTCHA" }, error: null });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    const response = await post(missingPerson);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ trackingCode: "EN-SIN-CAPTCHA" });
  });

  it("no bloquea los reportes con una configuración CAPTCHA parcial", async () => {
    rpc.mockResolvedValue({ data: { tracking_code: "EN-CAPTCHA-PARCIAL" }, error: null });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");

    const response = await post(missingPerson);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ trackingCode: "EN-CAPTCHA-PARCIAL" });
  });

  it("informa el límite de envíos sin revelar datos internos", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    const response = await post(missingPerson);
    expect(response.status).toBe(429);
    expect((await response.json()).message).toMatch(/varios reportes/i);
  });
});
