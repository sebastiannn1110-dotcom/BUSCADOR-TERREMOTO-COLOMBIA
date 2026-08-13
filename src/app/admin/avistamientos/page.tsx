import Link from "next/link";
import { redirect } from "next/navigation";
import { SightingsQueue } from "@/components/sightings-queue";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function AdminSightingsPage() {
  const { staff } = await getStaffContext();
  if (!staff) redirect("/admin/login?next=/admin/avistamientos");
  return <section className="admin"><Link href="/admin">← Panel</Link><h1>Avistamientos y reportes pendientes</h1><p className="lead">La aprobación publica solo una ubicación aproximada y una descripción revisada. Ninguna acción cambia el estado del caso.</p><SightingsQueue /></section>;
}
