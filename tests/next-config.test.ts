import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("configuración de imágenes públicas", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("limita retratos remotos al bucket público configurado", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.supabase.co");
    const { default: config } = await import("../next.config");
    expect(config.images?.remotePatterns).toEqual([{
      protocol: "https",
      hostname: "project.example.supabase.co",
      port: "",
      pathname: "/storage/v1/object/public/public-portraits/**"
    }]);
  });

  it("no publica los recursos sintéticos de demostración", () => {
    expect(existsSync(join(process.cwd(), "public", "test-avatars"))).toBe(false);
    expect(existsSync(join(process.cwd(), "data", "test-avatars", "test-supplies.png"))).toBe(true);
  });
});
