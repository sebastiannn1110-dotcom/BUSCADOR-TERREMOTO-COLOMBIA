import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { PeopleImporter } from "@/components/people-importer";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function ImportPeoplePage() {
  const { staff, authenticated } = await getStaffContext("admin");
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="el rol de administrador" />;
    redirect("/admin/login?next=/admin/importar-personas");
  }
  return <section className="admin">
    <Link href="/admin">← Panel</Link>
    <h1>Importar personas</h1>
    <p className="lead">Carga CSV o Excel, o pega una tabla. La vista previa valida campos, bloquea homónimos y evita repetir una importación ya registrada.</p>
    <p className="privacy-note">Una lista de desaparecidos revisada por moderación queda pendiente. Solo una fuente oficial confirmada publica registros automáticamente. Este flujo nunca crea fotos, edad ni sexo.</p>
    <p>
      <a href="/templates/desaparecidos-template.csv" download>Plantilla desaparecidos CSV</a> ·{" "}
      <a href="/templates/medicina-legal-fallecidos-template.csv" download>Plantilla fallecidos CSV</a>
    </p>
    <PeopleImporter />
  </section>;
}
