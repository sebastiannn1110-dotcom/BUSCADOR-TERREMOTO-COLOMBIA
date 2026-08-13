"use client";

import { useRouter } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/browser";

export function AdminLogout() {
  const router = useRouter();
  return <button className="button secondary" type="button" onClick={async () => {
    await browserSupabase()?.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }}>Cerrar sesión</button>;
}
