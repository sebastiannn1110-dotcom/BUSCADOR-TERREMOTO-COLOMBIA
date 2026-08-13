import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "encontrarnos",
    databaseConfigured: hasSupabase(),
    reportsConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    captchaConfigured: Boolean(process.env.CAPTCHA_PROVIDER && process.env.CAPTCHA_SECRET_KEY && process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY)
  });
}
