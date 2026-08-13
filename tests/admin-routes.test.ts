import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpc, getStaffContext } = vi.hoisted(() => ({ rpc: vi.fn(), getStaffContext: vi.fn() }));

vi.mock("@/lib/supabase/auth-server", () => ({ getStaffContext }));

import { POST as moderate } from "@/app/api/admin/sightings/route";
import { POST as importDeceased } from "@/app/api/admin/import-deceased/route";

describe("rutas administrativas", () => {
  beforeEach(() => {
    rpc.mockReset();
    getStaffContext.mockReset();
  });

  it("permite a moderación aprobar un avistamiento mediante el RPC auditado", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: { id: "22222222-2222-4222-8222-222222222222", role: "moderator" } });
    rpc.mockResolvedValue({ data: { moderationStatus: "approved", caseStatusChanged: false }, error: null });
    const response = await moderate(new NextRequest("http://localhost/api/admin/sightings", {
      method: "POST",
      body: JSON.stringify({
        reportId: "11111111-1111-4111-8111-111111111111",
        action: "approved",
        reason: "Información revisada",
        publicLocation: "Sector aproximado",
        publicDescription: "Avistamiento revisado por moderación."
      })
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("moderate_case_report", expect.objectContaining({ p_action: "approved" }));
    expect((await response.json()).result.caseStatusChanged).toBe(false);
  });

  it("bloquea la importación oficial para un usuario no administrador", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: null });
    const response = await importDeceased(new NextRequest("http://localhost/api/admin/import-deceased", {
      method: "POST",
      body: JSON.stringify({ csv: "datos", mode: "preview" })
    }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
