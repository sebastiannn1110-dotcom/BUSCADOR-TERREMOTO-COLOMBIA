import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { adminSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/supabase/auth-server";
import { hasObviousContactData } from "@/lib/request-security";

export const runtime = "nodejs";

const PRIVATE_EVIDENCE_BUCKET = "report-evidence";
const PUBLIC_PORTRAITS_BUCKET = "public-portraits";
const MAX_PORTRAIT_BYTES = 8 * 1024 * 1024;
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const reviewSchema = z.object({
  caseId: z.string().uuid(),
  action: z.enum(["publish", "reject", "duplicate", "request_information", "archive"]),
  reason: z.string().trim().min(3).max(1000),
  publicDescription: z.string().trim().max(800).optional(),
  publicLocation: z.string().trim().max(240).optional(),
  approvePhoto: z.boolean().optional().default(false),
  sourceMediaAssetId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (value.action === "publish" && !value.publicLocation?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicLocation"], message: "Publicar requiere un lugar público aproximado." });
  }
  if (value.action === "publish" && value.approvePhoto && !value.sourceMediaAssetId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceMediaAssetId"], message: "Selecciona la evidencia que se aprobará como retrato público." });
  }
  if (value.action !== "publish" && value.approvePhoto) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvePhoto"], message: "La foto solo puede aprobarse al publicar el caso." });
  }
});

type StaffMediaAsset = {
  id: string;
  caseId: string | null;
  assetType: string;
  storageBucket: string;
  privatePath: string;
  detectedMimeType: string | null;
  sizeBytes: number | null;
};

type DatabaseError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

function errorStatus(error: DatabaseError) {
  if (error.code === "42501") return 403;
  if (error.code === "P0002") return 404;
  if (error.code === "22023") return 400;
  return 500;
}

function databaseError(error: DatabaseError, message: string, status = errorStatus(error)) {
  return NextResponse.json(
    { message, code: error.code },
    { status, headers: privateHeaders }
  );
}

function isAllowedSourceMime(mimeType: string | null | undefined) {
  return mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp";
}

function validAsset(value: unknown): value is StaffMediaAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as Partial<StaffMediaAsset>;
  return typeof asset.id === "string"
    && (typeof asset.caseId === "string" || asset.caseId === null)
    && typeof asset.assetType === "string"
    && typeof asset.storageBucket === "string"
    && typeof asset.privatePath === "string"
    && (typeof asset.detectedMimeType === "string" || asset.detectedMimeType === null)
    && (typeof asset.sizeBytes === "number" || asset.sizeBytes === null);
}

export async function GET() {
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });

  const { data, error } = await db.rpc("get_pending_people_cases");
  if (error) {
    console.error("[ADMIN PENDING PEOPLE] queue RPC failed", { code: error.code });
    return databaseError(error, "No fue posible cargar las personas pendientes.");
  }
  return NextResponse.json({ cases: Array.isArray(data) ? data : [] }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Revisa la acción y los campos de moderación.", issues: parsed.error.flatten() }, { status: 400, headers: privateHeaders });
  }

  const { caseId, action, reason, approvePhoto, sourceMediaAssetId } = parsed.data;
  const publicDescription = action === "publish" ? parsed.data.publicDescription?.trim() || null : null;
  const publicLocation = action === "publish" ? parsed.data.publicLocation?.trim() || null : null;
  if (action === "publish" && [publicDescription, publicLocation].some((value) => value && hasObviousContactData(value))) {
    return NextResponse.json({ message: "Los campos públicos no pueden contener teléfonos ni correos." }, { status: 400, headers: privateHeaders });
  }
  let promotedPath: string | null = null;
  let promotedUrl: string | null = null;
  let serviceDb: ReturnType<typeof adminSupabase> = null;

  if (action === "publish" && approvePhoto && sourceMediaAssetId) {
    serviceDb = adminSupabase();
    if (!serviceDb) return NextResponse.json({ message: "La promoción segura de retratos no está configurada en el servidor." }, { status: 503, headers: privateHeaders });

    const { data: mediaData, error: mediaError } = await db.rpc("get_staff_media_asset", { p_asset_id: sourceMediaAssetId });
    if (mediaError) {
      console.error("[ADMIN PENDING PEOPLE] media access RPC failed", { code: mediaError.code, assetId: sourceMediaAssetId });
      return databaseError(mediaError, "No fue posible autorizar el acceso a la evidencia privada.");
    }
    if (!validAsset(mediaData) || mediaData.id !== sourceMediaAssetId || mediaData.caseId !== caseId || mediaData.assetType !== "portrait" || mediaData.storageBucket !== PRIVATE_EVIDENCE_BUCKET) {
      return NextResponse.json({ message: "La evidencia seleccionada no pertenece a este caso o no es una fuente privada válida." }, { status: 400, headers: privateHeaders });
    }

    if (!isAllowedSourceMime(mediaData.detectedMimeType) || mediaData.sizeBytes === null || mediaData.sizeBytes < 1 || mediaData.sizeBytes > MAX_PORTRAIT_BYTES) {
      return NextResponse.json({ message: "La evidencia seleccionada no es una imagen JPG, PNG o WebP válida de hasta 8 MB." }, { status: 415, headers: privateHeaders });
    }

    const { data: sourceBlob, error: downloadError } = await serviceDb.storage.from(PRIVATE_EVIDENCE_BUCKET).download(mediaData.privatePath);
    if (downloadError || !sourceBlob) {
      console.error("[ADMIN PENDING PEOPLE] private media download failed", { code: downloadError?.name || "DOWNLOAD_FAILED", assetId: sourceMediaAssetId });
      return NextResponse.json({ message: "No fue posible leer la evidencia privada seleccionada." }, { status: 500, headers: privateHeaders });
    }
    if (sourceBlob.size > MAX_PORTRAIT_BYTES) {
      return NextResponse.json({ message: "La evidencia seleccionada supera el límite de 8 MB." }, { status: 415, headers: privateHeaders });
    }
    if (sourceBlob.type && !isAllowedSourceMime(sourceBlob.type)) {
      return NextResponse.json({ message: "El contenido descargado no tiene un formato de imagen permitido." }, { status: 415, headers: privateHeaders });
    }

    let sanitizedPortrait: Buffer;
    try {
      sanitizedPortrait = await sharp(await sourceBlob.arrayBuffer(), { failOn: "warning", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, progressive: true })
        .toBuffer();
    } catch {
      return NextResponse.json({ message: "La evidencia no pudo validarse como imagen segura para publicación." }, { status: 415, headers: privateHeaders });
    }
    if (sanitizedPortrait.length < 1 || sanitizedPortrait.length > MAX_PORTRAIT_BYTES) {
      return NextResponse.json({ message: "El retrato procesado supera el límite seguro de 8 MB." }, { status: 415, headers: privateHeaders });
    }

    promotedPath = `portraits/${caseId}/${randomUUID()}.jpg`;
    const { error: uploadError } = await serviceDb.storage.from(PUBLIC_PORTRAITS_BUCKET).upload(promotedPath, sanitizedPortrait, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "3600"
    });
    if (uploadError) {
      console.error("[ADMIN PENDING PEOPLE] public portrait upload failed", { code: uploadError.name || "UPLOAD_FAILED", caseId });
      return NextResponse.json({ message: `No fue posible guardar el retrato aprobado en el bucket '${PUBLIC_PORTRAITS_BUCKET}'.` }, { status: 500, headers: privateHeaders });
    }
    promotedUrl = serviceDb.storage.from(PUBLIC_PORTRAITS_BUCKET).getPublicUrl(promotedPath).data.publicUrl || null;
    if (!promotedUrl) {
      await serviceDb.storage.from(PUBLIC_PORTRAITS_BUCKET).remove([promotedPath]);
      return NextResponse.json({ message: "El bucket público no devolvió una URL para el retrato aprobado." }, { status: 500, headers: privateHeaders });
    }
  }

  console.info("[ADMIN PENDING PEOPLE] Executing review RPC", { actorId: staff.id, caseId, action, approvesPhoto: Boolean(promotedPath) });
  const { data, error } = await db.rpc("review_pending_person_case", {
    p_case_id: caseId,
    p_action: action,
    p_reason: reason,
    p_public_description: publicDescription,
    p_public_location: publicLocation,
    p_source_media_asset_id: promotedPath ? sourceMediaAssetId : null,
    p_public_photo_path: promotedPath,
    p_public_photo_url: promotedUrl
  });
  if (error) {
    let cleanupFailed = false;
    if (promotedPath) {
      const cleanup = serviceDb ? await serviceDb.storage.from(PUBLIC_PORTRAITS_BUCKET).remove([promotedPath]) : { error: new Error("Service client unavailable") };
      cleanupFailed = Boolean(cleanup.error);
      if (cleanupFailed) console.error("[ADMIN PENDING PEOPLE] promoted portrait cleanup failed", { caseId });
    }
    console.error("[ADMIN PENDING PEOPLE] review RPC failed", { code: error.code, caseId, action });
    const response = databaseError(error, "No fue posible guardar la revisión del caso.");
    if (!cleanupFailed) return response;
    return NextResponse.json(
      { message: "No fue posible guardar la revisión y la limpieza del retrato requiere atención operativa.", code: error.code, cleanupFailed: true },
      { status: errorStatus(error), headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }

  return NextResponse.json({ result: data }, { headers: privateHeaders });
}
