import { MissingPersonForm } from "@/components/missing-person-form";

export default function ReportMissingPersonPage() {
  return <section className="form-page">
    <h1>Reportar a una persona desaparecida</h1>
    <p className="lead">Completa lo que sepas. El reporte queda pendiente de revisión y tus datos de contacto nunca se publican.</p>
    <MissingPersonForm />
  </section>;
}
