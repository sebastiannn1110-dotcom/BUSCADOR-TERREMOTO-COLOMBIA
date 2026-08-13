import { NextResponse } from "next/server";
import { z } from "zod";
import { adminSupabase } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

const assetIdSchema = z.string().uuid();
const PRIVATE_EVIDENCE_BUCKET = "report-evidence";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

type StaffMediaAsset = {
  id: string;
  storageBucket: string;
  privatePath: string;
  detectedMimeType: string | null;
};

function validAsset(value: unknown): value is StaffMediaAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as Partial<StaffMediaAsset>;
  return typeof asset.id === "string"
    && typeof asset.storageBucket === "string"
    && typeof asset.privatePath === "string"
    && (typeof asset.detectedMimeType === "string" || asset.detectedMimeType === null);
}

function responseMimeType(blob: Blob, metadataMimeType: string | null) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(blob.type.toLowerCase())) return blob.type.toLowerCase();
  if (metadataMimeType && allowed.includes(metadataMimeType.toLowerCase())) return metadataMimeType.toLowerCase();
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { db, staff } = await getStaffContext();
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });

  const parsedId = assetIdSchema.safeParse((await context.params).assetId);
  if (!parsedId.success) return NextResponse.json({ message: "El identificador de evidencia no es válido." }, { status: 400, headers: privateHeaders });

  const { data, error } = await db.rpc("get_staff_media_asset", { p_asset_id: parsedId.data });
  if (error) {
    console.error("[ADMIN PRIVATE MEDIA] access RPC failed", { code: error.code, assetId: parsedId.data });
    return NextResponse.json(
      { message: "No fue posible autorizar el acceso a la evidencia privada.", code: error.code },
      { status: error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 500, headers: privateHeaders }
    );
  }
  if (!validAsset(data) || data.id !== parsedId.data || data.storageBucket !== PRIVATE_EVIDENCE_BUCKET) {
    return NextResponse.json({ message: "La evidencia privada solicitada no está disponible." }, { status: 404, headers: privateHeaders });
  }

  const serviceDb = adminSupabase();
  if (!serviceDb) return NextResponse.json({ message: "La descarga segura de evidencia no está configurada en el servidor." }, { status: 503, headers: privateHeaders });
  const { data: blob, error: downloadError } = await serviceDb.storage.from(PRIVATE_EVIDENCE_BUCKET).download(data.privatePath);
  if (downloadError || !blob) {
    console.error("[ADMIN PRIVATE MEDIA] storage download failed", { code: downloadError?.name || "DOWNLOAD_FAILED", assetId: parsedId.data });
    return NextResponse.json({ message: "No fue posible descargar la evidencia privada." }, { status: 500, headers: privateHeaders });
  }
  const mimeType = responseMimeType(blob, data.detectedMimeType);
  if (!mimeType) return NextResponse.json({ message: "El formato de la evidencia privada no está permitido." }, { status: 415, headers: privateHeaders });

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": mimeType,
      "Content-Length": String(blob.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
