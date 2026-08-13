import { AiSearchForm } from "./ai-search-form";

export const dynamic = "force-dynamic";

export default function AiSearchPage() {
  const available = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

  return <AiSearchForm available={available} />;
}
