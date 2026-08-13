import { notFound } from "next/navigation";
import { InformationForm } from "@/components/information-form";
import { getCase } from "@/lib/cases";

export default async function PersonInformationPage({ params }: { params: Promise<{ slug: string }> }) {
  const item = await getCase((await params).slug);
  if (!item) notFound();
  return <section className="form-page">
    <h1>Enviar información sobre {item.full_name}</h1>
    <p className="lead">El reporte quedará pendiente de revisión. No cambia el estado del caso automáticamente.</p>
    <InformationForm caseId={item.id} />
  </section>;
}
