"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/browser";

export function AdminLoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const db = browserSupabase();
    if (!db) { setError("Supabase Auth no está configurado."); return; }
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    const { error: signInError } = await db.auth.signInWithPassword({
      email: String(values.get("email") || ""),
      password: String(values.get("password") || "")
    });
    setBusy(false);
    if (signInError) { setError("No fue posible iniciar sesión con esas credenciales."); return; }
    router.replace(nextPath.startsWith("/admin") ? nextPath : "/admin");
    router.refresh();
  }
  return <form className="report-form" onSubmit={submit} aria-busy={busy}>
    <label>Correo<input name="email" type="email" required autoComplete="email" /></label>
    <label>Contraseña<input name="password" type="password" required autoComplete="current-password" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button" disabled={busy}>{busy ? "Ingresando…" : "Iniciar sesión"}</button>
  </form>;
}
