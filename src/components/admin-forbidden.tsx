import Link from "next/link";

export function AdminForbidden({ requirement }: { requirement: string }) {
  return <section className="admin">
    <p className="eyebrow">Error 403</p>
    <h1>Acceso no autorizado</h1>
    <p className="lead">Tu sesión está activa, pero esta sección requiere {requirement}.</p>
    <p>No necesitas volver a iniciar sesión. Solicita a una persona administradora que revise los permisos de tu cuenta.</p>
    <Link className="button" href="/admin">Volver al panel administrativo</Link>
  </section>;
}
