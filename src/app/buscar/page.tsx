import { SearchResults } from "./search-results";

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; estado?: string; status?: string; pagina?: string }>;
}) {
  const parameters = await searchParams;
  return <SearchResults
    initialQuery={parameters.q || ""}
    initialStatus={parameters.estado || parameters.status || ""}
    initialPage={parameters.pagina || "1"}
  />;
}
