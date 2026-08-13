import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin-login-form";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = (await searchParams).next || "/admin";
  const { staff } = await getStaffContext();
  if (staff) redirect(nextPath.startsWith("/admin") ? nextPath : "/admin");
  return <section className="admin"><h1>Acceso administrativo</h1><p className="lead">Solo para personal autorizado. Los datos privados se consultan únicamente después de autenticar la sesión.</p><AdminLoginForm nextPath={nextPath} /></section>;
}
