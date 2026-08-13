import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type StaffRole = "moderator" | "responder" | "admin";
type RequiredStaffRole = "admin" | "moderator_or_admin";

export type StaffContext = {
  id: string;
  displayName: string;
  role: StaffRole;
};

function environmentValue(name: string) {
  return process.env[name]?.trim() || null;
}

export async function serverAuthSupabase() {
  const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL");
  const key = environmentValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values: { name: string; value: string; options: CookieOptions }[]) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Route handlers and server
          // actions can, and Supabase will refresh the session there.
        }
      }
    }
  });
}

export async function getStaffContext(requiredRole?: RequiredStaffRole) {
  const db = await serverAuthSupabase();
  if (!db) return { db: null, staff: null, authenticated: false };

  const { data: authData } = await db.auth.getUser();
  if (!authData.user) return { db, staff: null, authenticated: false };

  const { data: profile, error } = await db
    .from("profiles")
    .select("id, display_name, role, active")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (error || !profile?.active || !["moderator", "responder", "admin"].includes(profile.role)) {
    return { db, staff: null, authenticated: true };
  }
  if (requiredRole === "admin" && profile.role !== "admin") {
    return { db, staff: null, authenticated: true };
  }
  if (requiredRole === "moderator_or_admin" && !["moderator", "admin"].includes(profile.role)) {
    return { db, staff: null, authenticated: true };
  }

  return {
    db,
    authenticated: true,
    staff: {
      id: profile.id,
      displayName: profile.display_name,
      role: profile.role as StaffRole
    } satisfies StaffContext
  };
}
