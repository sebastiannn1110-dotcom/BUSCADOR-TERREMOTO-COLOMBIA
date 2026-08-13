import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
function configured(name: string) { return Boolean(process.env[name]?.trim()); }
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "encontrarnos",
    databaseConfigured: hasSupabase(),
    reportsConfigured: configured("SUPABASE_SERVICE_ROLE_KEY"),
    captchaConfigured: configured("CAPTCHA_PROVIDER") && configured("CAPTCHA_SECRET_KEY") && configured("NEXT_PUBLIC_CAPTCHA_SITE_KEY")
  });
}
