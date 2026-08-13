import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { ContactFollowupsQueue } from "@/components/contact-followups-queue";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function ContactFollowupsPage({ searchParams }: { searchParams: Promise<{ caseId?: string; reportId?: string }> }) {
  const { staff, authenticated } = await getStaffContext();
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="una cuenta activa del equipo" />;
    redirect("/admin/login?next=/admin/seguimiento-contactos");
  }
  const filters = await searchParams;

  return <section className="admin">
    <Link href="/admin">← Panel</Link>
    <h1>Seguimiento de contactos</h1>
    <p className="lead">El equipo autorizado actúa como intermediario. Registra aquí llamadas, mensajes y seguimientos; el sistema no envía WhatsApp ni SMS automáticamente.</p>
    <p className="privacy-note">Los nombres, números, correos, ubicaciones y resúmenes de contacto son privados y nunca se muestran en páginas públicas.</p>
    <ContactFollowupsQueue
      initialCaseId={filters.caseId || ""}
      initialReportId={filters.reportId || ""}
      canWrite={staff.role === "moderator" || staff.role === "admin"}
    />
  </section>;
}
