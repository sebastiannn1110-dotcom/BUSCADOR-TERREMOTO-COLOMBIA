import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyConfirmationLink } from "@/components/copy-confirmation-link";

const trackingPattern = /^[A-Z0-9-]{6,40}$/i;

export default async function ReportConfirmationPage({ params }: { params: Promise<{ trackingCode: string }> }) {
  const trackingCode = decodeURIComponent((await params).trackingCode).toUpperCase();
  if (!trackingPattern.test(trackingCode)) notFound();
  const path = `/reporte/confirmacion/${encodeURIComponent(trackingCode)}`;
  return <section className="form-page confirmation-page">
    <div className="success" role="status">
      <h1>Reporte recibido</h1>
      <p>Tu código de seguimiento es <strong>{trackingCode}</strong>.</p>
      <p>Recibimos tu reporte. Tu reporte no está publicado todavía. Un agente lo revisará antes de que aparezca en el buscador.</p>
      <code>{path}</code>
      <div className="form-actions"><CopyConfirmationLink path={path} /><Link className="button" href="/">Volver al inicio</Link></div>
    </div>
  </section>;
}
