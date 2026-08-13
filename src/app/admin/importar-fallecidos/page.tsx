import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { OfficialDeceasedImporter } from "@/components/official-deceased-importer";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function ImportDeceasedPage() {
  const { staff, authenticated } = await getStaffContext("admin");
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="el rol de administrador" />;
    redirect("/admin/login?next=/admin/importar-fallecidos");
  }
  return <section className="admin"><Link href="/admin">← Panel</Link><h1>Importar fallecidos confirmados</h1><p className="lead">Solo registros oficiales verificados de Medicina Legal. Primero se previsualizan las coincidencias; confirmar aplica estado, verificación, publicación, historial y auditoría.</p><p className="privacy-note">La referencia de autoridad y la justificación son privadas. Nunca se genera una foto artificial.</p><p><a href="/templates/medicina-legal-fallecidos-template.csv" download>Descargar plantilla CSV</a> · <Link href="/admin/importar-fallecidos/ayuda">Ver instrucciones</Link></p><OfficialDeceasedImporter /></section>;
}
