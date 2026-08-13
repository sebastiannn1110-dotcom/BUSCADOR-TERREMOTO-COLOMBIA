import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { AdminPeopleManager } from "@/components/admin-people-manager";
import { CaseMessageInbox } from "@/components/case-message-inbox";
import { PendingPeopleQueue } from "@/components/pending-people-queue";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function PendingPeoplePage({
  searchParams
}: {
  searchParams: Promise<{ seccion?: string }>;
}) {
  const { staff, authenticated } = await getStaffContext("moderator_or_admin");
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="el rol de moderador o administrador" />;
    redirect("/admin/login?next=/admin/personas-pendientes");
  }

  const requestedSection = (await searchParams).seccion;
  const section = requestedSection === "personas" || requestedSection === "mensajes" ? requestedSection : "pendientes";

  return <section className="admin">
    <Link href="/admin">← Panel</Link>
    <h1>Personas, mensajes y seguimiento</h1>
    <nav className="moderation-actions" aria-label="Secciones de administración de personas">
      <Link className={section === "pendientes" ? "button" : "button secondary"} href="/admin/personas-pendientes">Personas pendientes</Link>
      <Link className={section === "personas" ? "button" : "button secondary"} href="/admin/personas-pendientes?seccion=personas">Gestionar publicadas</Link>
      <Link className={section === "mensajes" ? "button" : "button secondary"} href="/admin/personas-pendientes?seccion=mensajes">Mensajes y seguimiento</Link>
    </nav>
    {section === "pendientes" && <>
      <h2>Personas pendientes</h2>
      <p className="lead">Revisa la información privada antes de publicar. Ningún caso aparece en el buscador hasta que un moderador o administrador lo aprueba.</p>
      <p className="privacy-note">Publicar siempre establece el caso como desaparecido y revisado por moderación. Esta pantalla no permite confirmar fallecimientos.</p>
      <PendingPeopleQueue />
    </>}
    {section === "personas" && <>
      <h2>Gestionar personas publicadas</h2>
      <p className="lead">Busca una persona y, si corresponde, retírala de las cards y de su ficha pública mediante una acción auditada.</p>
      <AdminPeopleManager canWithdraw={staff.role === "admin"} />
    </>}
    {section === "mensajes" && <>
      <h2>Bandeja privada de mensajes y seguimiento</h2>
      <p className="lead">Agrupa por caso la información enviada desde la web y el historial interno de contacto.</p>
      <CaseMessageInbox />
    </>}
  </section>;
}
