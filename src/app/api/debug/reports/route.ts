import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { reportError, reportsLog } from "@/lib/reports-observability";
import { adminSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const environmentNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "IP_HASH_SECRET",
  "CAPTCHA_PROVIDER",
  "NEXT_PUBLIC_CAPTCHA_SITE_KEY",
  "CAPTCHA_SECRET_KEY",
  "DEBUG_REPORTS_TOKEN",
  "ENABLE_TEST_DATA"
] as const;

function configured(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? "FOUND" : "MISSING";
}

function sameToken(received: string, expected: string) {
  const receivedHash = createHash("sha256").update(received).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

export async function GET(request: NextRequest) {
  const expectedToken = process.env.DEBUG_REPORTS_TOKEN?.trim();
  const receivedToken = request.headers.get("x-debug-token")?.trim() ?? "";

  if (!expectedToken) {
    return NextResponse.json({ message: "El endpoint de diagnóstico no está habilitado." }, { status: 503 });
  }
  if (!receivedToken || !sameToken(receivedToken, expectedToken)) {
    return NextResponse.json({ message: "No encontrado." }, { status: 404 });
  }

  const environment = Object.fromEntries(environmentNames.map((name) => [name, configured(name)]));
  const db = adminSupabase();
  if (!db) {
    return NextResponse.json({
      environment,
      database: { error: "Supabase server configuration is incomplete." },
      storage: { bucketsFound: [], error: "Supabase server configuration is incomplete." }
    }, { status: 503 });
  }

  const databaseQuery = 'rpc("reports_debug_snapshot")';
  reportsLog("info", "Executing debug query", { query: databaseQuery });
  const { data: database, error: databaseError } = await db.rpc("reports_debug_snapshot");
  if (databaseError) {
    reportsLog("error", "Debug query failed", {
      query: databaseQuery,
      error: reportError(databaseError)
    });
  } else {
    reportsLog("info", "Debug query completed", { query: databaseQuery });
  }

  const storageQuery = "storage.listBuckets()";
  reportsLog("info", "Executing debug query", { query: storageQuery });
  const { data: buckets, error: storageError } = await db.storage.listBuckets();
  if (storageError) {
    reportsLog("error", "Debug query failed", {
      query: storageQuery,
      error: reportError(storageError)
    });
  } else {
    reportsLog("info", "Debug query completed", { query: storageQuery });
  }

  const bucketsFound = (buckets ?? []).map((bucket) => ({
    name: bucket.name,
    public: bucket.public
  }));
  const expectedBuckets = ["public-portraits", "report-evidence"];
  const missingBuckets = expectedBuckets.filter((name) => !bucketsFound.some((bucket) => bucket.name === name));

  return NextResponse.json({
    environment,
    database: databaseError ? { error: reportError(databaseError) } : database,
    storage: {
      usedByReportsRoute: ["report-evidence"],
      expectedBuckets,
      bucketsFound,
      missingBuckets,
      error: storageError ? reportError(storageError) : null
    }
  }, { status: databaseError || storageError ? 503 : 200 });
}
