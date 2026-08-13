import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reporte recibido",
  robots: {
    index: false,
    follow: false
  }
};

export default function ReportConfirmationPage() {
  return <section className="form-page confirmation-page">
    <div className="success" role="status">
      <h1>Reporte recibido</h1>
      <p>Recibimos tu reporte. Todavía no está publicado. Un agente lo revisará antes de que aparezca en el buscador.</p>
      <p>Si el equipo necesita más información, se comunicará al número que dejaste en el formulario.</p>
      <div className="form-actions">
        <Link className="button" href="/">Volver al inicio</Link>
        <Link className="button secondary" href="/reportar-desaparecido">Reportar otra persona</Link>
      </div>
    </div>
  </section>;
}
