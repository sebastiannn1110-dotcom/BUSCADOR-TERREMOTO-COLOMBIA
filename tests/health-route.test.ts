import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  hasSupabase: vi.fn(),
  adminSupabase: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabase: mocks.hasSupabase,
  adminSupabase: mocks.adminSupabase
}));

import { GET } from "@/app/api/health/route";
import { appUrlConfiguredCorrectly } from "@/lib/app-url";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.rpc.mockReset();
    mocks.hasSupabase.mockReset().mockReturnValue(true);
    mocks.adminSupabase.mockReset().mockReturnValue({ rpc: mocks.rpc });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
  });

  it("marca APP_URL localhost como incorrecta en producción sin exponerla", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    mocks.rpc.mockResolvedValue({
      data: { schemaVersion: "202608130002", deceasedFilterReady: true },
      error: null
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.appUrlConfiguredCorrectly).toBe(false);
    expect(JSON.stringify(body)).not.toContain("localhost");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("confirma alcance de base, versión y filtro de fallecidos mediante el snapshot seguro", async () => {
    vi.stubEnv("APP_URL", "https://buscador-terremoto-colombia.onrender.com");
    mocks.rpc.mockResolvedValue({
      data: { schemaVersion: "202608130002", deceasedFilterReady: true },
      error: null
    });

    const response = await GET();
    const body = await response.json();

    expect(mocks.rpc).toHaveBeenCalledWith("reports_debug_snapshot");
    expect(body).toMatchObject({
      databaseConfigured: true,
      databaseReachable: true,
      schemaVersion: "202608130002",
      reportsConfigured: true,
      deceasedRouteAvailable: true,
      appUrlConfiguredCorrectly: true
    });
  });

  it("degrada de forma segura si Supabase no responde", async () => {
    vi.stubEnv("APP_URL", "https://buscador-terremoto-colombia.onrender.com");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "CONNECTION_ERROR", message: "sensitive" } });

    const body = await (await GET()).json();

    expect(body.databaseReachable).toBe(false);
    expect(body.schemaVersion).toBeNull();
    expect(body.deceasedRouteAvailable).toBe(false);
    expect(JSON.stringify(body)).not.toContain("sensitive");
  });

  it("rechaza APP_URL vacía, no HTTPS o local", () => {
    vi.stubEnv("APP_URL", "");
    expect(appUrlConfiguredCorrectly()).toBe(false);
    vi.stubEnv("APP_URL", "http://buscador-terremoto-colombia.onrender.com");
    expect(appUrlConfiguredCorrectly()).toBe(false);
    vi.stubEnv("APP_URL", "https://localhost");
    expect(appUrlConfiguredCorrectly()).toBe(false);
    vi.stubEnv("APP_URL", "https://localhost.example.invalid");
    expect(appUrlConfiguredCorrectly()).toBe(false);
    vi.stubEnv("APP_URL", "https://example.invalid/localhost");
    expect(appUrlConfiguredCorrectly()).toBe(false);
  });

  it("marca CAPTCHA configurado solo con Turnstile y las dos claves", async () => {
    vi.stubEnv("CAPTCHA_PROVIDER", "hcaptcha");
    vi.stubEnv("CAPTCHA_SECRET_KEY", "secret-test");
    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_SITE_KEY", "site-test");
    expect((await (await GET()).json()).captchaConfigured).toBe(false);

    vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");
    expect((await (await GET()).json()).captchaConfigured).toBe(true);
  });
});
