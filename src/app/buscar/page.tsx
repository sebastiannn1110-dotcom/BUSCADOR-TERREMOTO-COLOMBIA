import { SearchResults } from "./search-results";
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) { return <SearchResults initialQuery={(await searchParams).q || ""} initialStatus={(await searchParams).status || ""} />; }
