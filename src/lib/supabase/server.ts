import { createClient } from "@supabase/supabase-js";

function environmentValue(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

export function hasSupabase() {
  return Boolean(environmentValue("NEXT_PUBLIC_SUPABASE_URL") && environmentValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"));
}

export function publicSupabase() {
  const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL");
  const key = environmentValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function adminSupabase() {
  const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL");
  const key = environmentValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
