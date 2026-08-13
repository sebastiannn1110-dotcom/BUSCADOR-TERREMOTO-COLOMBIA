import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLogout } from "@/components/admin-logout";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { staff } = await getStaffContext();
  if (!staff) redirect("/admin/login?next=/admin");
  return <section className="admin">
    <div className="admin-heading"><div><h1>Moderación</h1><p>Sesión: {staff.displayName || staff.id} · {staff.role}</p></div><AdminLogout /></div>
    <div className="admin-grid">
      <Link className="action" href="/admin/avistamientos"><strong>Avistamientos pendientes</strong><small>Aprobar, rechazar, duplicar, escalar o solicitar información.</small></Link>
      {staff.role === "admin" && <Link className="action" href="/admin/importar-fallecidos"><strong>Importar fallecidos oficiales</strong><small>Vista previa, detección de duplicados y confirmación auditada.</small></Link>}
    </div>
    <div className="security-panel"><h2>Datos protegidos</h2><p>Contactos, evidencia, ubicaciones privadas, referencias de autoridad y notas internas nunca se cargan en páginas públicas.</p></div>
  </section>;
}
