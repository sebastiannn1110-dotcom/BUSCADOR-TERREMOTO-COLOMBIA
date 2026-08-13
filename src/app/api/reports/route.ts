import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { informationSchema, reportSchema, validImage } from "@/lib/validation";
import { requestFingerprint } from "@/lib/request-security";
import { reportError, reportsLog } from "@/lib/reports-observability";
import { adminSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_JSON_BYTES = 24 * 1024;
const MAX_MULTIPART_BYTES = 9 * 1024 * 1024;
const EVIDENCE_BUCKET = "report-evidence";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^\d{2}:\d{2}$/;

class RequestProblem extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function localTimestamp(value: string | undefined) {
  const timestamp = value?.trim();
  if (!timestamp) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(timestamp) ? `${timestamp}:00-05:00` : timestamp;
}

function statedLength(request: NextRequest) {
  const value = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(value) ? value : 0;
}

async function readBoundedBody(request: NextRequest, limit: number) {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > limit - size) {
        try {
          await reader.cancel();
        } catch {
          // The size rejection remains authoritative even if the client stream
          // has already disconnected and cannot be cancelled cleanly.
        }
        throw new RequestProblem(413, "El envío es demasiado grande.");
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) return new Uint8Array();

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  const limit = contentType.toLowerCase().includes("multipart/form-data") ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES;
  if (statedLength(request) > limit) throw new RequestProblem(413, "El envío es demasiado grande.");
  const body = await readBoundedBody(request, limit);

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    const raw: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (!(value instanceof File)) raw[key] = value;
    }
    const candidate = form.get("photo");
    const photo = candidate instanceof File && candidate.size > 0 ? candidate : null;
    return { raw, photo };
  }

  const text = new TextDecoder().decode(body);
  try {
    return { raw: JSON.parse(text) as unknown, photo: null };
  } catch {
    throw new RequestProblem(400, "Revisa los campos marcados e inténtalo de nuevo.");
  }
}

async function verifyCaptcha(token: string | undefined, request: NextRequest) {
  const provider = process.env.CAPTCHA_PROVIDER?.trim().toLowerCase();
  const secret = process.env.CAPTCHA_SECRET_KEY?.trim();
  const siteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY?.trim();
  if (!provider || !secret || !siteKey) return "skipped" as const;
  if (provider !== "turnstile") return "unconfigured" as const;
  if (!token) return "invalid" as const;

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || ""
      }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store"
    });
    const data = await response.json() as { success?: boolean };
    return data.success === true ? "ok" as const : "invalid" as const;
  } catch {
    return "invalid" as const;
  }
}

function photoExtension(type: string) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let uploadedPath: string | null = null;
  const db = adminSupabase();
  reportsLog("info", "Request received", {
    requestId,
    method: request.method,
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length")
  });

  try {
    reportsLog("info", "Reading request body", { requestId });
    const requestData = await readRequest(request);
    reportsLog("info", "Request body read", { requestId, hasPhoto: Boolean(requestData.photo) });
    if (!requestData.raw || typeof requestData.raw !== "object" || Array.isArray(requestData.raw)) {
      throw new RequestProblem(400, "Revisa los campos marcados e inténtalo de nuevo.");
    }
    const raw = requestData.raw as Record<string, unknown>;
    const isInformationReport = Object.prototype.hasOwnProperty.call(raw, "caseId");
    const parsed = isInformationReport ? informationSchema.safeParse(raw) : reportSchema.safeParse(raw);
    if (!parsed.success) {
      reportsLog("info", "Body validation failed", { requestId, reportKind: isInformationReport ? "case_information" : "missing_person", issues: parsed.error.issues });
      return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo.", issues: parsed.error.flatten() }, { status: 400 });
    }
    reportsLog("info", "Body validated", { requestId, reportKind: isInformationReport ? "case_information" : "missing_person" });

    if (requestData.photo && !validImage(requestData.photo)) {
      reportsLog("info", "Evidence rejected", { requestId, mimeType: requestData.photo.type, size: requestData.photo.size });
      return NextResponse.json({ message: "La imagen debe ser JPG, PNG o WebP y pesar máximo 8 MB." }, { status: 400 });
    }
    if (parsed.data.website) {
      reportsLog("info", "Honeypot submission discarded", { requestId });
      return NextResponse.json({ received: true });
    }

    reportsLog("info", "Verifying CAPTCHA", { requestId });
    const captcha = await verifyCaptcha(parsed.data.captchaToken, request);
    reportsLog("info", "CAPTCHA checked", { requestId, result: captcha });
    if (captcha === "unconfigured") return NextResponse.json({ message: "El envío seguro todavía no está configurado. Inténtalo más tarde." }, { status: 503 });
    if (captcha === "invalid") return NextResponse.json({ message: "Completa la verificación de seguridad e inténtalo de nuevo." }, { status: 400 });

    reportsLog("info", "Creating request fingerprint", { requestId });
    const fingerprint = requestFingerprint(request);
    if (!fingerprint) return NextResponse.json({ message: "El envío seguro todavía no está configurado. Inténtalo más tarde." }, { status: 503 });
    reportsLog("info", "Request fingerprint created", { requestId });

    if (!db) return NextResponse.json({ message: "El envío requiere configurar la conexión segura a Supabase." }, { status: 503 });
    reportsLog("info", "Supabase client created", { requestId });

    let payload: Record<string, unknown>;
    if (isInformationReport) {
      const caseId = typeof raw.caseId === "string" ? raw.caseId.trim() : "";
      if (!uuidPattern.test(caseId)) return NextResponse.json({ message: "El identificador del caso no es válido." }, { status: 400 });
      const information = parsed.data as typeof informationSchema._output;
      payload = {
        kind: "case_information",
        caseId,
        reportType: information.reportType,
        reportContext: information.reportType === "sighting" ? information.reportContext || null : null,
        eventAt: localTimestamp(information.eventAt || (information.eventDate ? `${information.eventDate}T${information.eventTime || "12:00"}` : undefined)),
        location: information.location || null,
        description: information.description,
        reporterName: null,
        phone: information.phone || null,
        email: null,
        relationship: null,
        preferredContact: information.phone ? "phone" : null,
        consentAt: new Date().toISOString(),
        requestFingerprint: fingerprint
      };
    } else {
      const report = parsed.data as typeof reportSchema._output;
      const date = report.lastSeenDate.trim();
      const time = report.lastSeenTime?.trim() || "12:00";
      if (!datePattern.test(date) || !timePattern.test(time)) return NextResponse.json({ message: "Indica una fecha y hora aproximadas válidas." }, { status: 400 });
      payload = {
        kind: "missing_person",
        fullName: report.fullName,
        alias: null,
        approximateAge: report.approximateAge ?? null,
        isMinor: report.approximateAge === undefined || report.approximateAge < 18,
        lastSeenAt: `${date}T${time}:00-05:00`,
        location: report.location,
        clothing: null,
        features: report.identificationDescription || null,
        circumstances: null,
        reporterName: report.reporterName,
        phone: report.phone,
        email: null,
        relationship: null,
        preferredContact: "phone",
        consentAt: new Date().toISOString(),
        requestFingerprint: fingerprint
      };
    }

    if (requestData.photo) {
      uploadedPath = `reports/${new Date().getUTCFullYear()}/${randomUUID()}.${photoExtension(requestData.photo.type)}`;
      reportsLog("info", "Uploading private evidence", { requestId, query: 'storage.from("report-evidence").upload(path, file)', bucket: EVIDENCE_BUCKET });
      const { error } = await db.storage.from(EVIDENCE_BUCKET).upload(uploadedPath, requestData.photo, { contentType: requestData.photo.type, upsert: false });
      reportsLog("info", "Upload completed", { requestId, query: 'storage.from("report-evidence").upload(path, file)', success: !error });
      if (error) {
        reportsLog("error", "Storage upload failed", { requestId, query: 'storage.from("report-evidence").upload(path, file)', bucket: EVIDENCE_BUCKET, error: reportError(error) });
        return NextResponse.json({ message: `No pudimos guardar la evidencia en el bucket privado '${EVIDENCE_BUCKET}'.`, requestId }, { status: 500 });
      }
      payload.photoPath = uploadedPath;
      payload.photoMimeType = requestData.photo.type;
      payload.photoOriginalName = requestData.photo.name;
      payload.photoSize = requestData.photo.size;
    }

    reportsLog("info", "Report payload built", { requestId, reportKind: payload.kind });
    reportsLog("info", "Executing Supabase query", { requestId, query: 'rpc("submit_public_report", { p_payload })' });
    const { data, error } = await db.rpc("submit_public_report", { p_payload: payload });
    reportsLog("info", "Supabase query completed", { requestId, query: 'rpc("submit_public_report", { p_payload })', success: !error });
    if (error) {
      reportsLog("error", "Supabase query failed", { requestId, query: 'rpc("submit_public_report", { p_payload })', error: reportError(error) });
      if (error.code === "P0002") return NextResponse.json({ message: "Este caso ya no está disponible para recibir información." }, { status: 404 });
      if (error.code === "P0001") return NextResponse.json({ message: "Has enviado varios reportes en poco tiempo. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
      if (error.code === "22023") return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo." }, { status: 400 });
      if (error.code === "PGRST202") return NextResponse.json({ message: "La base de datos aún necesita la migración de reportes." }, { status: 503 });
      return NextResponse.json({ message: "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.", requestId }, { status: 500 });
    }

    const trackingCode = typeof data?.tracking_code === "string" ? data.tracking_code : null;
    if (!trackingCode) {
      reportsLog("error", "RPC returned no tracking code", { requestId, query: 'rpc("submit_public_report", { p_payload })', responseType: data === null ? "null" : typeof data });
      return NextResponse.json({ message: "No pudimos confirmar el envío del reporte.", requestId }, { status: 500 });
    }
    uploadedPath = null;
    reportsLog("info", "Finished successfully", { requestId, trackingCode });
    return NextResponse.json({ received: true }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestProblem) {
      reportsLog("info", "Request rejected", { requestId, status: error.status, error: reportError(error) });
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    reportsLog("error", "Request failed", { requestId, error: reportError(error) });
    return NextResponse.json({ message: "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.", requestId }, { status: 500 });
  } finally {
    if (uploadedPath && db) {
      reportsLog("info", "Removing orphaned evidence", { requestId, query: 'storage.from("report-evidence").remove([path])', bucket: EVIDENCE_BUCKET });
      const { error } = await db.storage.from(EVIDENCE_BUCKET).remove([uploadedPath]);
      if (error) reportsLog("error", "Orphan cleanup failed", { requestId, query: 'storage.from("report-evidence").remove([path])', bucket: EVIDENCE_BUCKET, error: reportError(error) });
      else reportsLog("info", "Orphaned evidence removed", { requestId });
    }
  }
}
