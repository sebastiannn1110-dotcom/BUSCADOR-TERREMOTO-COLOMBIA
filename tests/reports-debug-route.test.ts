import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const listBuckets = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  adminSupabase: () => ({ rpc, storage: { listBuckets } })
}));

import { GET } from "@/app/api/debug/reports/route";

describe("GET /api/debug/reports", () => {
  const debugToken = "diagnostic-token-with-at-least-32-characters";

  beforeEach(() => {
    rpc.mockReset();
    listBuckets.mockReset();
    vi.stubEnv("DEBUG_REPORTS_TOKEN", debugToken);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
    vi.stubEnv("APP_URL", "https://example.invalid");
  });

  it("oculta el diagnóstico sin el token temporal", async () => {
    const response = await GET(new NextRequest("http://localhost/api/debug/reports"));
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("no habilita el diagnóstico con un token débil", async () => {
    vi.stubEnv("DEBUG_REPORTS_TOKEN", "corto");
    const response = await GET(new NextRequest("http://localhost/api/debug/reports", {
      headers: { "x-debug-token": "corto" }
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devuelve metadatos, RLS, migración, buckets y estado de variables", async () => {
    rpc.mockResolvedValue({
      data: {
        schemaVersion: "202608130002",
        lastMigrationApplied: "202608130002",
        publishedCounts: { missing: 4, deceasedConfirmed: 39 },
        deceasedFilterReady: true,
        tables: [{ name: "people", found: true, rlsEnabled: true }]
      },
      error: null
    });
    listBuckets.mockResolvedValue({
      data: [{ name: "public-portraits", public: true }, { name: "report-evidence", public: false }],
      error: null
    });

    const response = await GET(new NextRequest("http://localhost/api/debug/reports", {
      headers: { "x-debug-token": debugToken }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(rpc).toHaveBeenCalledWith("reports_debug_snapshot");
    expect(body.environment.SUPABASE_SERVICE_ROLE_KEY).toBe("FOUND");
    expect(body.environment.APP_URL).toBe("FOUND");
    expect(body.database.tables[0]).toMatchObject({ name: "people", rlsEnabled: true });
    expect(body.database.publishedCounts).toEqual({ missing: 4, deceasedConfirmed: 39 });
    expect(body.database.deceasedFilterReady).toBe(true);
    expect(body.storage.bucketsFound).toEqual([{ name: "public-portraits", public: true }, { name: "report-evidence", public: false }]);
    expect(body.storage.usedByReportsRoute).toEqual(["report-evidence"]);
    expect(body.storage.missingBuckets).toEqual([]);
  });
});
