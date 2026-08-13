import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpc, getStaffContext, adminSupabase, storageFrom } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getStaffContext: vi.fn(),
  adminSupabase: vi.fn(),
  storageFrom: vi.fn()
}));

vi.mock("@/lib/supabase/auth-server", () => ({ getStaffContext }));
vi.mock("@/lib/supabase/server", () => ({ adminSupabase }));

import { POST as moderate } from "@/app/api/admin/sightings/route";
import { GET as getPendingPeople, POST as reviewPendingPerson } from "@/app/api/admin/pending-people/route";
import { GET as getPrivateMedia } from "@/app/api/admin/private-media/[assetId]/route";
import { GET as getContactFollowups, POST as logContactFollowup } from "@/app/api/admin/contact-followups/route";
import { GET as getManagedPeople, POST as withdrawPerson } from "@/app/api/admin/people/route";
import { GET as getCaseMessages } from "@/app/api/admin/case-messages/route";
import { POST as importDeceased } from "@/app/api/admin/import-deceased/route";

const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const moderator = { id: "22222222-2222-4222-8222-222222222222", role: "moderator" };
const admin = { id: "33333333-3333-4333-8333-333333333333", role: "admin" };
const caseId = "44444444-4444-4444-8444-444444444444";
const reportId = "11111111-1111-4111-8111-111111111111";
const assetId = "55555555-5555-4555-8555-555555555555";
const contactId = "66666666-6666-4666-8666-666666666666";

function authenticated(staff = moderator) {
  getStaffContext.mockResolvedValue({ db: { rpc }, staff });
}

describe("rutas administrativas", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-signing-secret-not-real";
    rpc.mockReset();
    getStaffContext.mockReset();
    adminSupabase.mockReset();
    storageFrom.mockReset();
  });

  afterAll(() => {
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it("permite a moderación aprobar un avistamiento mediante el RPC auditado", async () => {
    authenticated();
    rpc.mockResolvedValue({ data: { moderationStatus: "approved", caseStatusChanged: false }, error: null });
    const response = await moderate(new NextRequest("http://localhost/api/admin/sightings", {
      method: "POST",
      body: JSON.stringify({
        reportId,
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

  it("protege la cola de personas pendientes antes de consultar el RPC", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: null });
    const response = await getPendingPeople();
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lista personas pendientes mediante el RPC de staff", async () => {
    authenticated();
    rpc.mockResolvedValue({ data: [{ caseId, fullName: "Persona pendiente" }], error: null });
    const response = await getPendingPeople();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_pending_people_cases");
    expect((await response.json()).cases).toHaveLength(1);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("publica una persona sin foto usando solo parámetros públicos revisados", async () => {
    authenticated();
    rpc.mockResolvedValue({ data: { caseId, action: "publish", published: true }, error: null });
    const response = await reviewPendingPerson(new NextRequest("http://localhost/api/admin/pending-people", {
      method: "POST",
      body: JSON.stringify({
        caseId,
        action: "publish",
        reason: "Caso revisado por moderación",
        publicDescription: "Descripción pública revisada",
        publicLocation: "Sector público aproximado",
        approvePhoto: false
      })
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("review_pending_person_case", {
      p_case_id: caseId,
      p_action: "publish",
      p_reason: "Caso revisado por moderación",
      p_public_description: "Descripción pública revisada",
      p_public_location: "Sector público aproximado",
      p_source_media_asset_id: null,
      p_public_photo_path: null,
      p_public_photo_url: null
    });
    expect(adminSupabase).not.toHaveBeenCalled();
  });

  it("bloquea PII incrustada en campos destinados a publicación", async () => {
    authenticated();
    const pendingResponse = await reviewPendingPerson(new NextRequest("http://localhost/api/admin/pending-people", {
      method: "POST",
      body: JSON.stringify({
        caseId,
        action: "publish",
        reason: "Revisión de privacidad del caso",
        publicDescription: "Información pública; llamar al 300 123 4567.",
        publicLocation: "Sector público aproximado"
      })
    }));
    expect(pendingResponse.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    authenticated();
    const sightingResponse = await moderate(new NextRequest("http://localhost/api/admin/sightings", {
      method: "POST",
      body: JSON.stringify({
        reportId,
        action: "approved",
        reason: "Revisión del avistamiento",
        publicLocation: "Escribir a privado@example.invalid",
        publicDescription: "Descripción pública revisada y aproximada."
      })
    }));
    expect(sightingResponse.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("elimina el retrato promovido si falla el RPC que publica el caso", async () => {
    authenticated();
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_staff_media_asset") return { data: {
        id: assetId,
        caseId,
        assetType: "portrait",
        storageBucket: "report-evidence",
        privatePath: "reports/2026/private.jpg",
        detectedMimeType: "image/jpeg",
        sizeBytes: 4
      }, error: null };
      return { data: null, error: { message: "invalid review", code: "22023" } };
    });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const privateBucket = { download: vi.fn().mockResolvedValue({ data: new Blob([validPng], { type: "image/jpeg" }), error: null }) };
    const publicBucket = {
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/public-portraits/${path}` } })),
      remove
    };
    storageFrom.mockImplementation((bucket: string) => bucket === "report-evidence" ? privateBucket : publicBucket);
    adminSupabase.mockReturnValue({ storage: { from: storageFrom } });

    const response = await reviewPendingPerson(new NextRequest("http://localhost/api/admin/pending-people", {
      method: "POST",
      body: JSON.stringify({
        caseId,
        action: "publish",
        reason: "Caso revisado por moderación",
        publicLocation: "Sector público aproximado",
        approvePhoto: true,
        sourceMediaAssetId: assetId
      })
    }));
    expect(response.status).toBe(400);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_staff_media_asset", { p_asset_id: assetId });
    expect(rpc).toHaveBeenNthCalledWith(2, "review_pending_person_case", expect.objectContaining({
      p_case_id: caseId,
      p_source_media_asset_id: assetId,
      p_public_photo_path: expect.stringMatching(new RegExp(`^portraits/${caseId}/[0-9a-f-]+\\.jpg$`)),
      p_public_photo_url: expect.stringContaining("/public/public-portraits/portraits/")
    }));
    const [, sanitizedBody, uploadOptions] = publicBucket.upload.mock.calls[0] as [string, Buffer, { contentType: string }];
    expect(Buffer.isBuffer(sanitizedBody)).toBe(true);
    expect([...sanitizedBody.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect(sanitizedBody.equals(validPng)).toBe(false);
    expect(uploadOptions.contentType).toBe("image/jpeg");
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^portraits/${caseId}/`))]);
  });

  it("publica un retrato sanitizado y conserva el objeto cuando la revisión termina", async () => {
    authenticated();
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_staff_media_asset") return { data: {
        id: assetId,
        caseId,
        assetType: "portrait",
        storageBucket: "report-evidence",
        privatePath: "reports/2026/private.jpg",
        detectedMimeType: "image/png",
        sizeBytes: 68
      }, error: null };
      return { data: { caseId, action: "publish", published: true }, error: null };
    });
    const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const publicBucket = {
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/public-portraits/${path}` } })),
      remove
    };
    storageFrom.mockImplementation((bucket: string) => bucket === "report-evidence"
      ? { download: vi.fn().mockResolvedValue({ data: new Blob([validPng], { type: "image/png" }), error: null }) }
      : publicBucket);
    adminSupabase.mockReturnValue({ storage: { from: storageFrom } });

    const response = await reviewPendingPerson(new NextRequest("http://localhost/api/admin/pending-people", {
      method: "POST",
      body: JSON.stringify({
        caseId,
        action: "publish",
        reason: "Retrato revisado por moderación",
        publicLocation: "Sector público aproximado",
        approvePhoto: true,
        sourceMediaAssetId: assetId
      })
    }));

    expect(response.status).toBe(200);
    expect(publicBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^portraits/${caseId}/[0-9a-f-]+\\.jpg$`)),
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg", upsert: false })
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "review_pending_person_case", expect.objectContaining({
      p_source_media_asset_id: assetId,
      p_public_photo_path: expect.stringMatching(new RegExp(`^portraits/${caseId}/[0-9a-f-]+\\.jpg$`)),
      p_public_photo_url: expect.stringContaining("/storage/v1/object/public/public-portraits/portraits/")
    }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("hace proxy binario de evidencia solo después del RPC auditado de acceso", async () => {
    authenticated();
    rpc.mockResolvedValue({ data: {
      id: assetId,
      storageBucket: "report-evidence",
      privatePath: "reports/2026/private.jpg",
      detectedMimeType: "image/jpeg"
    }, error: null });
    const download = vi.fn().mockResolvedValue({ data: new Blob(["foto"], { type: "image/jpeg" }), error: null });
    storageFrom.mockReturnValue({ download });
    adminSupabase.mockReturnValue({ storage: { from: storageFrom } });

    const response = await getPrivateMedia(new Request(`http://localhost/api/admin/private-media/${assetId}`), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_staff_media_asset", { p_asset_id: assetId });
    expect(download).toHaveBeenCalledWith("reports/2026/private.jpg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("foto");
  });

  it("protege el proxy privado sin tocar Storage para una sesión no autorizada", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: null });
    const response = await getPrivateMedia(new Request(`http://localhost/api/admin/private-media/${assetId}`), { params: Promise.resolve({ assetId }) });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(adminSupabase).not.toHaveBeenCalled();
  });

  it("registra cada contacto mediante el RPC auditado", async () => {
    authenticated();
    rpc.mockResolvedValue({ data: { followupId: "77777777-7777-4777-8777-777777777777", status: "contactado" }, error: null });
    const response = await logContactFollowup(new NextRequest("http://localhost/api/admin/contact-followups", {
      method: "POST",
      body: JSON.stringify({
        caseId,
        reportId,
        contactId,
        targetType: "informante",
        contactMethod: "llamada",
        contactStatus: "contactado",
        summaryPrivate: "Se verificó recepción de la información.",
        nextFollowupAt: null
      })
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("log_contact_followup", {
      p_case_id: caseId,
      p_report_id: reportId,
      p_contact_id: contactId,
      p_target_type: "informante",
      p_contact_method: "llamada",
      p_contact_status: "contactado",
      p_summary_private: "Se verificó recepción de la información.",
      p_next_followup_at: null
    });
    expect(getStaffContext).toHaveBeenCalledWith("moderator_or_admin");
  });

  it("protege la cola de seguimiento y usa su RPC para staff", async () => {
    getStaffContext.mockResolvedValueOnce({ db: { rpc }, staff: null });
    expect((await getContactFollowups()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();

    authenticated();
    rpc.mockResolvedValue({ data: [{ caseId, reportId }], error: null });
    const response = await getContactFollowups();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_contact_followup_queue");
  });

  it("lista personas administradas sin exponer la consulta fuera del RPC", async () => {
    authenticated();
    rpc.mockResolvedValue({ data: [{ caseId, fullName: "Persona administrada" }], error: null });

    const response = await getManagedPeople(new NextRequest("http://localhost/api/admin/people?q=Persona"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledWith("get_admin_people_cases", {
      p_query: "Persona",
      p_limit: 200,
      p_offset: 0
    });
    expect((await response.json()).people).toHaveLength(1);
  });

  it("retira una persona publicada solo mediante el RPC administrativo auditado", async () => {
    authenticated(admin);
    rpc.mockResolvedValue({ data: { caseId, withdrawn: true, publicationStatus: "archived" }, error: null });

    const response = await withdrawPerson(new NextRequest("http://localhost/api/admin/people", {
      method: "POST",
      body: JSON.stringify({ caseId, reason: "Retiro solicitado y verificado" })
    }));

    expect(response.status).toBe(200);
    expect(getStaffContext).toHaveBeenCalledWith("admin");
    expect(rpc).toHaveBeenCalledWith("withdraw_person_case", {
      p_case_id: caseId,
      p_reason: "Retiro solicitado y verificado"
    });
  });

  it("impide que un moderador retire una persona publicada", async () => {
    getStaffContext.mockResolvedValue({ db: { rpc }, staff: null, authenticated: true });

    const response = await withdrawPerson(new NextRequest("http://localhost/api/admin/people", {
      method: "POST",
      body: JSON.stringify({ caseId, reason: "Intento no autorizado" })
    }));

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("carga la bandeja privada de mensajes agrupada por caso", async () => {
    authenticated(admin);
    rpc.mockResolvedValue({ data: [{ caseId, personName: "Persona con mensajes" }], error: null });

    const response = await getCaseMessages();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledWith("get_admin_case_message_threads", { p_limit: 100 });
    expect((await response.json()).threads).toHaveLength(1);
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

  it("exige vista previa vigente y confirmación de fuente antes de importar", async () => {
    authenticated(admin);
    rpc.mockImplementation(async (name: string) => name === "preview_official_deceased_import"
      ? { data: [{ row: 1, decision: "create" }], error: null }
      : { data: { created: 1, updated: 0, total: 1 }, error: null });
    const csv = "full_name,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed\nPersona Oficial,42,Medicina Legal,Comunicado 04,Descripción,Lugar,2026-08-12";
    const previewResponse = await importDeceased(new NextRequest("http://localhost/api/admin/import-deceased", {
      method: "POST",
      body: JSON.stringify({ csv, mode: "preview" })
    }));
    const previewBody = await previewResponse.json() as { previewToken: string };
    expect(previewResponse.status).toBe(200);
    expect(previewBody.previewToken).toBeTruthy();

    const missingConfirmation = await importDeceased(new NextRequest("http://localhost/api/admin/import-deceased", {
      method: "POST",
      body: JSON.stringify({ csv, mode: "confirm", reason: "Referencia oficial verificada", previewToken: previewBody.previewToken })
    }));
    expect(missingConfirmation.status).toBe(400);
    expect(rpc.mock.calls.filter(([name]) => name === "import_official_deceased")).toHaveLength(0);

    const confirmation = await importDeceased(new NextRequest("http://localhost/api/admin/import-deceased", {
      method: "POST",
      body: JSON.stringify({ csv, mode: "confirm", reason: "Referencia oficial verificada", confirmedOfficialSource: true, previewToken: previewBody.previewToken })
    }));
    expect(confirmation.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("import_official_deceased", expect.objectContaining({ p_reason: "Referencia oficial verificada" }));
  });
});
