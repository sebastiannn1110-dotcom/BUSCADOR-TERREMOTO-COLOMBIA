import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { informationSchema, reportSchema } from "@/lib/validation";
import { requestFingerprint } from "@/lib/request-security";
import { reportError, reportsLog } from "@/lib/reports-observability";
import { adminSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 24 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const demoCasePattern = /^demo-[0-9]{3}$/;
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

async function readJson(request: NextRequest): Promise<unknown> {
  const statedLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(statedLength) && statedLength > MAX_REQUEST_BYTES) {
    throw new RequestProblem(413, "El envío es demasiado grande.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new RequestProblem(413, "El envío es demasiado grande.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestProblem(400, "Revisa los campos marcados e inténtalo de nuevo.");
  }
}

async function verifyCaptcha(token: string | undefined, request: NextRequest) {
  const provider = process.env.CAPTCHA_PROVIDER;
  const secret = process.env.CAPTCHA_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY;

  // CAPTCHA is an optional additional protection. The server still applies a
  // bounded request body, honeypot and database-backed rate limit without it.
  // A partial Turnstile configuration cannot be completed by the browser, so
  // keep CAPTCHA disabled until all values have been configured together.
  if (!provider || !secret || !siteKey) return "skipped" as const;
  if (provider !== "turnstile" || !secret) return "unconfigured" as const;
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

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  reportsLog("info", "Request received", {
    requestId,
    method: request.method,
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length")
  });

  try {
    reportsLog("info", "Reading request body", { requestId });
    const body = await readJson(request);
    reportsLog("info", "Request body read", { requestId });
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      reportsLog("info", "Body rejected", { requestId, reason: "not_an_object" });
      return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo." }, { status: 400 });
    }

    const raw = body as Record<string, unknown>;
    const isInformationReport = Object.prototype.hasOwnProperty.call(raw, "caseId");
    const parsed = isInformationReport ? informationSchema.safeParse(raw) : reportSchema.safeParse(raw);
    if (!parsed.success) {
      reportsLog("info", "Body validation failed", {
        requestId,
        reportKind: isInformationReport ? "case_information" : "missing_person",
        issueCount: parsed.error.issues.length
      });
      return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo.", issues: parsed.error.flatten() }, { status: 400 });
    }
    reportsLog("info", "Body validated", {
      requestId,
      reportKind: isInformationReport ? "case_information" : "missing_person"
    });
    if (parsed.data.website) {
      reportsLog("info", "Honeypot submission discarded", { requestId });
      return NextResponse.json({ trackingCode: "RECIBIDO" });
    }

    reportsLog("info", "Verifying CAPTCHA", { requestId });
    const captcha = await verifyCaptcha(parsed.data.captchaToken, request);
    reportsLog("info", "CAPTCHA checked", { requestId, result: captcha });
    if (captcha === "unconfigured") {
      return NextResponse.json({ message: "El envío seguro todavía no está configurado. Inténtalo más tarde." }, { status: 503 });
    }
    if (captcha === "invalid") {
      return NextResponse.json({ message: "Completa la verificación de seguridad e inténtalo de nuevo." }, { status: 400 });
    }

    reportsLog("info", "Creating request fingerprint", { requestId });
    const fingerprint = requestFingerprint(request);
    if (!fingerprint) {
      return NextResponse.json({ message: "El envío seguro todavía no está configurado. Inténtalo más tarde." }, { status: 503 });
    }
    reportsLog("info", "Request fingerprint created", { requestId });

    reportsLog("info", "Creating Supabase client", { requestId });
    const db = adminSupabase();
    if (!db) {
      return NextResponse.json({ message: "El envío requiere configurar la conexión segura a Supabase." }, { status: 503 });
    }
    reportsLog("info", "Supabase client created", { requestId });

    let payload: Record<string, unknown>;
    if (isInformationReport) {
      const caseId = typeof raw.caseId === "string" ? raw.caseId.trim() : "";
      const canResolveDemoCase = process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_DATA === "true" && demoCasePattern.test(caseId);
      let resolvedCaseId = caseId;
      if (!uuidPattern.test(caseId) && !canResolveDemoCase) {
        return NextResponse.json({ message: "El identificador del caso no es válido." }, { status: 400 });
      }
      if (canResolveDemoCase) {
        reportsLog("info", "Executing Supabase query", {
          requestId,
          query: 'rpc("get_public_case", { case_slug })'
        });
        const { data, error } = await db.rpc("get_public_case", { case_slug: caseId });
        reportsLog("info", "Supabase query completed", {
          requestId,
          query: 'rpc("get_public_case", { case_slug })',
          success: !error
        });
        const demoId = typeof data?.[0]?.id === "string" ? data[0].id : null;
        if (error || !demoId || !uuidPattern.test(demoId)) {
          if (error) {
            reportsLog("error", "Supabase query failed", {
              requestId,
              query: 'rpc("get_public_case", { case_slug })',
              error: reportError(error)
            });
          }
          return NextResponse.json({ message: "Este caso de demostración no está disponible para recibir información." }, { status: 404 });
        }
        resolvedCaseId = demoId;
      }

      const information = parsed.data as typeof informationSchema._output;
      payload = {
        kind: "case_information",
        caseId: resolvedCaseId,
        reportType: information.reportType,
        eventAt: localTimestamp(information.eventAt),
        location: information.location || null,
        description: information.description,
        requestFingerprint: fingerprint
      };
    } else {
      const report = parsed.data as typeof reportSchema._output;
      const date = report.lastSeenDate.trim();
      const time = report.lastSeenTime?.trim() || "12:00";
      if (!datePattern.test(date) || !timePattern.test(time)) {
        return NextResponse.json({ message: "Indica una fecha y hora aproximadas válidas." }, { status: 400 });
      }

      const rawAge = raw.approximateAge;
      payload = {
        kind: "missing_person",
        fullName: report.fullName,
        alias: null,
        approximateAge: rawAge === "" || rawAge === undefined || rawAge === null ? null : report.approximateAge,
        isMinor: false,
        lastSeenAt: `${date}T${time}:00-05:00`,
        location: report.location,
        clothing: report.clothing || null,
        features: report.features || null,
        circumstances: "Reporte inicial enviado por familiar.",
        reporterName: report.reporterName,
        phone: report.phone,
        email: null,
        preferredContact: "phone",
        requestFingerprint: fingerprint
      };
    }

    reportsLog("info", "Report payload built", { requestId, reportKind: payload.kind });
    reportsLog("info", "Executing Supabase query", {
      requestId,
      query: 'rpc("submit_public_report", { p_payload })'
    });
    const { data, error } = await db.rpc("submit_public_report", { p_payload: payload });
    reportsLog("info", "Supabase query completed", {
      requestId,
      query: 'rpc("submit_public_report", { p_payload })',
      success: !error
    });
    if (error) {
      reportsLog("error", "Supabase query failed", {
        requestId,
        query: 'rpc("submit_public_report", { p_payload })',
        error: reportError(error)
      });
      if (error.code === "P0002") {
        return NextResponse.json({ message: "Este caso ya no está disponible para recibir información." }, { status: 404 });
      }
      if (error.code === "P0001") {
        return NextResponse.json({ message: "Has enviado varios reportes en poco tiempo. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
      }
      if (error.code === "22023") {
        return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo." }, { status: 400 });
      }
      if (error.code === "PGRST202") {
        return NextResponse.json({ message: "La base de datos aún necesita la migración de reportes." }, { status: 503 });
      }
      return NextResponse.json({ message: "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.", requestId }, { status: 500 });
    }

    const trackingCode = typeof data?.tracking_code === "string" ? data.tracking_code : null;
    if (!trackingCode) {
      reportsLog("error", "RPC returned no tracking code", {
        requestId,
        query: 'rpc("submit_public_report", { p_payload })',
        responseType: data === null ? "null" : typeof data
      });
      return NextResponse.json({ message: "No pudimos confirmar el envío del reporte.", requestId }, { status: 500 });
    }
    reportsLog("info", "Finished successfully", { requestId });
    return NextResponse.json({ trackingCode }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestProblem) {
      reportsLog("info", "Request rejected", {
        requestId,
        status: error.status,
        error: reportError(error)
      });
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    reportsLog("error", "Request failed", { requestId, error: reportError(error) });
    return NextResponse.json({ message: "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.", requestId }, { status: 500 });
  }
}
