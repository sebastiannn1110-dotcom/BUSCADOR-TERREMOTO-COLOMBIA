import { createClient } from "@supabase/supabase-js";
export function hasSupabase() { return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY); }
export function publicSupabase() { if (!hasSupabase()) return null; return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } }); }
export function adminSupabase() { const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!hasSupabase() || !key) return null; return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } }); }
