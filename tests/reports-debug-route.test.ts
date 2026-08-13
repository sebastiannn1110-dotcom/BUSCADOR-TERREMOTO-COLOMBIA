import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const listBuckets = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  adminSupabase: () => ({ rpc, storage: { listBuckets } })
}));

import { GET } from "@/app/api/debug/reports/route";

describe("GET /api/debug/reports", () => {
  beforeEach(() => {
    rpc.mockReset();
    listBuckets.mockReset();
    vi.stubEnv("DEBUG_REPORTS_TOKEN", "diagnostic-token");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
  });

  it("oculta el diagnóstico sin el token temporal", async () => {
    const response = await GET(new NextRequest("http://localhost/api/debug/reports"));
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devuelve metadatos, RLS, migración, buckets y estado de variables", async () => {
    rpc.mockResolvedValue({
      data: {
        schemaVersion: "202608120003",
        lastMigrationApplied: "202608120003",
        tables: [{ name: "people", found: true, rlsEnabled: true }]
      },
      error: null
    });
    listBuckets.mockResolvedValue({
      data: [{ name: "public-portraits", public: true }],
      error: null
    });

    const response = await GET(new NextRequest("http://localhost/api/debug/reports", {
      headers: { "x-debug-token": "diagnostic-token" }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("reports_debug_snapshot");
    expect(body.environment.SUPABASE_SERVICE_ROLE_KEY).toBe("FOUND");
    expect(body.database.tables[0]).toMatchObject({ name: "people", rlsEnabled: true });
    expect(body.storage.bucketsFound).toEqual([{ name: "public-portraits", public: true }]);
    expect(body.storage.missingBuckets).toEqual([]);
  });
});
