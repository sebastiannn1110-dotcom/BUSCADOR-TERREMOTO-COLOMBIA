import { NextResponse } from "next/server";
import { appUrlConfiguredCorrectly } from "@/lib/app-url";
import { adminSupabase, hasSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DebugSnapshot = {
  schemaVersion?: unknown;
  deceasedFilterReady?: unknown;
};

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  let databaseReachable = false;
  let schemaVersion: string | null = null;
  let deceasedRouteAvailable = false;
  const database = adminSupabase();

  if (database) {
    try {
      const { data, error } = await database.rpc("reports_debug_snapshot");
      if (!error && isRecord(data)) {
        databaseReachable = true;
        const snapshot = data as DebugSnapshot;
        schemaVersion = typeof snapshot.schemaVersion === "string" && /^\d{12}$/u.test(snapshot.schemaVersion)
          ? snapshot.schemaVersion
          : null;
        deceasedRouteAvailable = snapshot.deceasedFilterReady === true;
      }
    } catch {
      // Health responses expose only state booleans, never raw connection errors.
    }
  }

  return NextResponse.json({
    status: "ok",
    service: "encontrarnos",
    databaseConfigured: hasSupabase(),
    databaseReachable,
    schemaVersion,
    reportsConfigured: configured("SUPABASE_SERVICE_ROLE_KEY"),
    deceasedRouteAvailable,
    appUrlConfiguredCorrectly: appUrlConfiguredCorrectly(),
    captchaConfigured: process.env.CAPTCHA_PROVIDER?.trim().toLowerCase() === "turnstile"
      && configured("CAPTCHA_SECRET_KEY")
      && configured("NEXT_PUBLIC_CAPTCHA_SITE_KEY")
  }, {
    headers: { "Cache-Control": "no-store" }
  });
}
