import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { PendingPeopleQueue } from "@/components/pending-people-queue";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function PendingPeoplePage() {
  const { staff, authenticated } = await getStaffContext("moderator_or_admin");
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="el rol de moderador o administrador" />;
    redirect("/admin/login?next=/admin/personas-pendientes");
  }

  return <section className="admin">
    <Link href="/admin">← Panel</Link>
    <h1>Personas pendientes</h1>
    <p className="lead">Revisa la información privada antes de publicar. Ningún caso aparece en el buscador hasta que un moderador o administrador lo aprueba.</p>
    <p className="privacy-note">Publicar siempre establece el caso como desaparecido y revisado por moderación. Esta pantalla no permite confirmar fallecimientos.</p>
    <PendingPeopleQueue />
  </section>;
}
