import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin-forbidden";
import { getStaffContext } from "@/lib/supabase/auth-server";

export default async function ImportHelpPage() {
  const { staff, authenticated } = await getStaffContext("admin");
  if (!staff) {
    if (authenticated) return <AdminForbidden requirement="el rol de administrador" />;
    redirect("/admin/login?next=/admin/importar-fallecidos/ayuda");
  }
  return <section className="admin"><Link href="/admin/importar-fallecidos">← Importador</Link><h1>Preparar el archivo oficial</h1><ol><li>Descarga la plantilla CSV o Excel sin cambiar los encabezados.</li><li>Transcribe los datos de la publicación oficial y verifica cada fila con una segunda revisión humana.</li><li>Usa <code>Medicina Legal</code> en <code>source_name</code> y una URL o identificador verificable en <code>source_reference</code>.</li><li>Deja edad, género, fecha o lugar vacíos cuando la fuente no los informe.</li><li>Genera la vista previa y detente si aparece “Revisión manual”.</li><li>Justifica y confirma. La operación queda auditada.</li></ol></section>;
}
