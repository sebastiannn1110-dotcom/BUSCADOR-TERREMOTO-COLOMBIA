import { NextRequest, NextResponse } from "next/server";
import { informationSchema, reportSchema } from "@/lib/validation";
import { requestFingerprint } from "@/lib/request-security";
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

  // CAPTCHA is an optional additional protection. The server still applies a
  // bounded request body, honeypot and database-backed rate limit without it.
  if (!provider && !secret) return "skipped" as const;
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
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo." }, { status: 400 });
    }

    const raw = body as Record<string, unknown>;
    const isInformationReport = Object.prototype.hasOwnProperty.call(raw, "caseId");
    const parsed = isInformationReport ? informationSchema.safeParse(raw) : reportSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ message: "Revisa los campos marcados e inténtalo de nuevo.", issues: parsed.error.flatten() }, { status: 400 });
    }
    if (parsed.data.website) return NextResponse.json({ trackingCode: "RECIBIDO" });

    const captcha = await verifyCaptcha(parsed.data.captchaToken, request);
    if (captcha === "unconfigured") {
      return NextResponse.json({ message: "El envío seguro todavía no está configurado. Inténtalo más tarde." }, { status: 503 });
    }
    if (captcha === "invalid") {
      return NextResponse.json({ message: "Completa la verificación de seguridad e inténtalo de nuevo." }, { status: 400 });
    }

    const fingerprint = requestFingerprint(request);
    if (!fingerprint) {
      return NextResponse.json({ message: "El envío seguro todavía no está configurado. Inténtalo más tarde." }, { status: 503 });
    }

    const db = adminSupabase();
    if (!db) {
      return NextResponse.json({ message: "El envío requiere configurar la conexión segura a Supabase." }, { status: 503 });
    }

    let payload: Record<string, unknown>;
    if (isInformationReport) {
      const caseId = typeof raw.caseId === "string" ? raw.caseId.trim() : "";
      const canResolveDemoCase = process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_DATA === "true" && demoCasePattern.test(caseId);
      let resolvedCaseId = caseId;
      if (!uuidPattern.test(caseId) && !canResolveDemoCase) {
        return NextResponse.json({ message: "El identificador del caso no es válido." }, { status: 400 });
      }
      if (canResolveDemoCase) {
        const { data, error } = await db.rpc("get_public_case", { case_slug: caseId });
        const demoId = typeof data?.[0]?.id === "string" ? data[0].id : null;
        if (error || !demoId || !uuidPattern.test(demoId)) {
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

    const { data, error } = await db.rpc("submit_public_report", { p_payload: payload });
    if (error) {
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
      console.error("Report submission database error", error.code);
      return NextResponse.json({ message: "No pudimos enviar el reporte. Inténtalo de nuevo más tarde." }, { status: 500 });
    }

    const trackingCode = typeof data?.tracking_code === "string" ? data.tracking_code : null;
    if (!trackingCode) {
      return NextResponse.json({ message: "No pudimos confirmar el envío del reporte." }, { status: 500 });
    }
    return NextResponse.json({ trackingCode }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestProblem) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Report submission failed");
    return NextResponse.json({ message: "No pudimos enviar el reporte. Inténtalo de nuevo más tarde." }, { status: 500 });
  }
}
