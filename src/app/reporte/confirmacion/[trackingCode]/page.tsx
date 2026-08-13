import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyConfirmationLink } from "@/components/copy-confirmation-link";

const trackingPattern = /^[A-Z0-9-]{6,40}$/i;

export default async function ReportConfirmationPage({
  params,
  searchParams
}: {
  params: Promise<{ trackingCode: string }>;
  searchParams?: Promise<{ tipo?: string }>;
}) {
  const trackingCode = decodeURIComponent((await params).trackingCode).toUpperCase();
  if (!trackingPattern.test(trackingCode)) notFound();
  const information = (await searchParams)?.tipo === "informacion";
  const path = `/reporte/confirmacion/${encodeURIComponent(trackingCode)}${information ? "?tipo=informacion" : ""}`;
  const configuredOrigin = process.env.APP_URL?.trim().replace(/\/$/u, "");
  const confirmationUrl = configuredOrigin ? `${configuredOrigin}${path}` : path;

  return <section className="form-page confirmation-page">
    <div className="success" role="status">
      <h1>{information ? "Información recibida" : "Reporte recibido"}</h1>
      <p>Tu código de seguimiento es <strong>{trackingCode}</strong>.</p>
      <p>{information
        ? "Recibimos tu información. Será revisada por el equipo antes de mostrarse públicamente o usarse para contactar a la familia."
        : "Recibimos tu reporte. Todavía no está publicado. Un agente lo revisará antes de que aparezca en el buscador."}</p>
      <code>{confirmationUrl}</code>
      <div className="form-actions">
        <CopyConfirmationLink path={path} />
        <Link className="button" href="/">Volver al inicio</Link>
      </div>
    </div>
  </section>;
}
