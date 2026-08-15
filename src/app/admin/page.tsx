import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { AdminLogout } from "@/components/admin-logout";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

const roleLabels = {
  admin: "Administrador",
  moderator: "Moderador",
  responder: "Respondiente"
} as const;

export default async function AdminPage() {
  const { staff, authenticated } = await getStaffContext();
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="una cuenta activa del equipo" />;
    redirect("/admin/login?next=/admin");
  }
  return <section className="admin">
    <div className="admin-heading"><div><h1>Moderación</h1><p>Sesión: {staff.displayName || staff.id} · {roleLabels[staff.role]}</p></div><AdminLogout /></div>
    <div className="admin-grid">
      {staff.role !== "responder" && <Link className="action" href="/admin/personas-pendientes"><strong>Personas pendientes</strong><small>Revisar y publicar casos nuevos como desaparecidos.</small></Link>}
      <Link className="action" href="/admin/avistamientos"><strong>Posibles avistamientos</strong><small>Aprobar, rechazar, duplicar, escalar o solicitar información.</small></Link>
      <Link className="action" href="/admin/seguimiento-contactos"><strong>Seguimiento de contactos</strong><small>Registrar el contacto privado con familias, reportantes e informantes.</small></Link>
      {staff.role === "admin" && <Link className="action" href="/admin/importar-personas"><strong>Importar personas</strong><small>Desaparecidos o fallecidos, en CSV/Excel, con vista previa y auditoría.</small></Link>}
    </div>
    <div className="security-panel"><h2>Datos protegidos</h2><p>Contactos, evidencia, ubicaciones privadas, referencias de autoridad y notas internas nunca se cargan en páginas públicas.</p></div>
  </section>;
}
