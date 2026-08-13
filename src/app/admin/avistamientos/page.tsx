import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { SightingsQueue } from "@/components/sightings-queue";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function AdminSightingsPage() {
  const { staff, authenticated } = await getStaffContext();
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="una cuenta activa del equipo" />;
    redirect("/admin/login?next=/admin/avistamientos");
  }
  return <section className="admin">
    <Link href="/admin">← Panel</Link>
    <h1>Posibles avistamientos e información recibida</h1>
    <p className="lead">La aprobación publica solo una ubicación aproximada y una descripción revisada. Ninguna acción cambia el estado del caso.</p>
    <nav className="moderation-actions" aria-label="Áreas administrativas">
      <Link href="/admin/personas-pendientes">Personas pendientes</Link>
      <Link href="/admin/seguimiento-contactos">Seguimiento de contactos</Link>
    </nav>
    <SightingsQueue canModerate={staff.role === "moderator" || staff.role === "admin"} />
  </section>;
}
