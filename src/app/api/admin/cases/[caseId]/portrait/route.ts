import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { adminSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

const PUBLIC_BUCKET = "public-portraits";
const MAX_BYTES = 8 * 1024 * 1024;
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const parametersSchema = z.object({ caseId: z.string().uuid() });
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedSharpFormats = new Set(["jpeg", "png", "webp"]);

type PortraitRpcResult = {
  oldObjectPath?: unknown;
  action?: unknown;
};

function errorStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023" || code === "P0001") return 400;
  return 500;
}

function safeOldObjectPath(value: unknown, caseId: string) {
  return typeof value === "string"
    && new RegExp(`^portraits/${caseId}/[0-9a-f-]{36}\\.jpg$`, "u").test(value)
    ? value
    : null;
}

async function removeOldObject(
  serviceDb: NonNullable<ReturnType<typeof adminSupabase>>,
  result: PortraitRpcResult,
  caseId: string
) {
  const path = safeOldObjectPath(result.oldObjectPath, caseId);
  if (!path) return false;
  const { error } = await serviceDb.storage.from(PUBLIC_BUCKET).remove([path]);
  if (error) {
    console.error("[PUBLIC PORTRAIT] Old object cleanup failed", { caseId, code: error.name || "REMOVE_FAILED" });
    return true;
  }
  return false;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> }
) {
  const parameters = parametersSchema.safeParse(await context.params);
  if (!parameters.success) return NextResponse.json({ message: "El caso no es válido." }, { status: 400, headers: privateHeaders });
  const { caseId } = parameters.data;
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Solo moderadores o administradores pueden cambiar fotos públicas." }, { status: 403, headers: privateHeaders });
  const serviceDb = adminSupabase();
  if (!serviceDb) return NextResponse.json({ message: "El almacenamiento de retratos no está configurado." }, { status: 503, headers: privateHeaders });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "La solicitud de imagen no es válida." }, { status: 400, headers: privateHeaders });
  }
  const file = form.get("file");
  const reason = typeof form.get("reason") === "string" ? String(form.get("reason")).trim() : "";
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_BYTES) {
    return NextResponse.json({ message: "Selecciona una imagen JPG, PNG o WebP de hasta 8 MB." }, { status: 400, headers: privateHeaders });
  }
  if (!allowedMimeTypes.has(file.type)) {
    return NextResponse.json({ message: "Solo se aceptan imágenes JPG, PNG y WebP." }, { status: 415, headers: privateHeaders });
  }
  if (reason.length < 3 || reason.length > 1000) {
    return NextResponse.json({ message: "Indica una razón interna de 3 a 1000 caracteres." }, { status: 400, headers: privateHeaders });
  }

  const input = Buffer.from(await file.arrayBuffer());
  let portrait: Buffer;
  try {
    const image = sharp(input, { failOn: "warning", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !allowedSharpFormats.has(metadata.format)) throw new Error("unsupported");
    portrait = await image
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ message: "El archivo no contiene una imagen JPG, PNG o WebP válida." }, { status: 415, headers: privateHeaders });
  }
  if (portrait.length < 1 || portrait.length > MAX_BYTES) {
    return NextResponse.json({ message: "La imagen procesada supera el límite de 8 MB." }, { status: 415, headers: privateHeaders });
  }

  const path = `portraits/${caseId}/${randomUUID()}.jpg`;
  const sha256 = createHash("sha256").update(portrait).digest("hex");
  const { error: uploadError } = await serviceDb.storage.from(PUBLIC_BUCKET).upload(path, portrait, {
    contentType: "image/jpeg",
    cacheControl: "0",
    upsert: false
  });
  if (uploadError) {
    console.error("[PUBLIC PORTRAIT] Upload failed", { caseId, code: uploadError.name || "UPLOAD_FAILED" });
    return NextResponse.json({ message: "No fue posible guardar la foto pública." }, { status: 500, headers: privateHeaders });
  }
  const publicUrl = serviceDb.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl || "";
  if (!publicUrl) {
    await serviceDb.storage.from(PUBLIC_BUCKET).remove([path]);
    return NextResponse.json({ message: "Storage no devolvió la URL pública de la foto." }, { status: 500, headers: privateHeaders });
  }

  const { data, error } = await db.rpc("set_public_case_portrait", {
    p_case_id: caseId,
    p_public_path: path,
    p_public_url: publicUrl,
    p_size_bytes: portrait.length,
    p_sha256: sha256,
    p_reason: reason
  });
  if (error) {
    const cleanup = await serviceDb.storage.from(PUBLIC_BUCKET).remove([path]);
    if (cleanup.error) console.error("[PUBLIC PORTRAIT] Failed upload cleanup", { caseId });
    return NextResponse.json({ message: "No fue posible vincular la foto al caso.", code: error.code }, { status: errorStatus(error.code), headers: privateHeaders });
  }

  const result = data && typeof data === "object" && !Array.isArray(data) ? data as PortraitRpcResult : {};
  const cleanupPending = await removeOldObject(serviceDb, result, caseId);
  return NextResponse.json({
    message: "Foto actualizada correctamente.",
    action: result.action,
    cleanupPending
  }, { headers: privateHeaders });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> }
) {
  const parameters = parametersSchema.safeParse(await context.params);
  if (!parameters.success) return NextResponse.json({ message: "El caso no es válido." }, { status: 400, headers: privateHeaders });
  const { caseId } = parameters.data;
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Solo moderadores o administradores pueden quitar fotos públicas." }, { status: 403, headers: privateHeaders });
  const parsed = z.object({ reason: z.string().trim().min(3).max(1000) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Indica una razón interna de 3 a 1000 caracteres." }, { status: 400, headers: privateHeaders });

  const { data, error } = await db.rpc("remove_public_case_portrait", {
    p_case_id: caseId,
    p_reason: parsed.data.reason
  });
  if (error) return NextResponse.json({ message: "No fue posible quitar la foto pública.", code: error.code }, { status: errorStatus(error.code), headers: privateHeaders });

  const result = data && typeof data === "object" && !Array.isArray(data) ? data as PortraitRpcResult : {};
  const serviceDb = adminSupabase();
  const cleanupPending = serviceDb ? await removeOldObject(serviceDb, result, caseId) : true;
  return NextResponse.json({ message: "Foto pública eliminada correctamente.", cleanupPending }, { headers: privateHeaders });
}
