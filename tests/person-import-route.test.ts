import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpc, getStaffContext } = vi.hoisted(() => ({ rpc: vi.fn(), getStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/auth-server", () => ({ getStaffContext }));

import { POST } from "@/app/api/admin/import-people/route";

const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const csv = [
  "source_row,full_name,department_disappearance,municipality_disappearance,source_name,source_reference,public_description",
  "1,Persona Importada Ficticia,Caldas,,Lista ficticia,Referencia ficticia,Descripción pública ficticia."
].join("\n");

function request(mode: "preview" | "confirm", previewToken = "") {
  const form = new FormData();
  form.set("importType", "missing");
  form.set("verificationLevel", "moderator_reviewed");
  form.set("sourceName", "Lista ficticia");
  form.set("sourceReference", "Referencia ficticia");
  form.set("defaultPublicDescription", "Descripción pública ficticia.");
  form.set("mode", mode);
  form.set("reason", mode === "confirm" ? "Importación ficticia revisada" : "");
  form.set("confirmedOfficialSource", "false");
  form.set("previewToken", previewToken);
  form.set("pastedText", csv);
  return new NextRequest("http://localhost/api/admin/import-people", { method: "POST", body: form });
}

describe("API unificada de importación", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-import-signing-secret";
    rpc.mockReset();
    getStaffContext.mockReset();
  });
  afterAll(() => {
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it("bloquea al público antes de analizar el archivo", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: null, authenticated: false });
    const response = await POST(request("preview"));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("firma la vista previa y confirma una importación pendiente idempotente", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: { id: "11111111-1111-4111-8111-111111111111", role: "admin" } });
    rpc.mockImplementation(async (name: string) => name === "preview_missing_people_import"
      ? { data: [{ row: 1, fullName: "Persona Importada Ficticia", normalizedName: "persona importada ficticia", matchCount: 0, existingCaseId: null, decision: "create" }], error: null }
      : { data: { created: 1, updated: 0, skipped: 0, published: 0, pendingReview: 1, total: 1 }, error: null });

    const preview = await POST(request("preview"));
    const body = await preview.json() as { previewToken: string };
    expect(preview.status).toBe(200);
    expect(body.previewToken).toBeTruthy();

    const confirmation = await POST(request("confirm", body.previewToken));
    expect(confirmation.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("import_missing_people", expect.objectContaining({
      p_verification_level: "moderator_reviewed",
      p_confirmed_official: false,
      p_reason: "Importación ficticia revisada"
    }));
    expect((await confirmation.json()).result).toMatchObject({ pendingReview: 1, published: 0 });
  });

  it("bloquea homónimos indicados por la segunda vista previa", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: { id: "11111111-1111-4111-8111-111111111111", role: "admin" } });
    rpc.mockResolvedValue({ data: [{ row: 1, decision: "review_required", reviewReason: "existing_normalized_name_requires_manual_review" }], error: null });
    const preview = await POST(request("preview"));
    const body = await preview.json() as { previewToken: string };
    const confirmation = await POST(request("confirm", body.previewToken));
    expect(confirmation.status).toBe(409);
    expect(rpc.mock.calls.some(([name]) => name === "import_missing_people")).toBe(false);
  });
});
