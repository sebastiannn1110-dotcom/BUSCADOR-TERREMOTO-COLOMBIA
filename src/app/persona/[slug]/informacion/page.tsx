import { notFound } from "next/navigation";
import { InformationForm, type InformationKind } from "@/components/information-form";
import { getCase } from "@/lib/cases";

export default async function PersonInformationPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tipo?: string }>;
}) {
  const item = await getCase((await params).slug);
  if (!item) notFound();
  const requestedType = (await searchParams).tipo;
  const initialKind: InformationKind = requestedType === "correction" ? "correction" : "sighting_alive";

  return <section className="form-page">
    <h1>Enviar información sobre {item.full_name}</h1>
    <p className="lead">La información quedará pendiente y privada hasta que el equipo la revise. No cambia el estado del caso automáticamente.</p>
    <InformationForm caseId={item.id} initialKind={initialKind} />
  </section>;
}
