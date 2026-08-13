import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { hasObviousContactData, requestFingerprint } from "@/lib/request-security";
import { searchCases } from "@/lib/cases";

export const runtime = "nodejs";

const MAX_QUERY_CHARS = 800;
const MAX_REQUEST_BYTES = 2 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const searchWindows = new Map<string, { startedAt: number; count: number }>();

const tool = {
  type: "function" as const,
  name: "search_people",
  description: "Busca exclusivamente casos públicos en la base de datos.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      name_or_place: { type: "string", minLength: 1, maxLength: MAX_QUERY_CHARS },
      status: { type: ["string", "null"], enum: ["missing", "possibly_trapped", "located_alive", "reunited", "deceased_confirmed", null] }
    },
    required: ["name_or_place", "status"],
    additionalProperties: false
  }
};

function isAllowed(fingerprint: string) {
  const now = Date.now();
  const current = searchWindows.get(fingerprint);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    searchWindows.set(fingerprint, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

async function readQuery(request: NextRequest) {
  const statedLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(statedLength) && statedLength > MAX_REQUEST_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return null;
  try {
    const body: unknown = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body) && typeof (body as { query?: unknown }).query === "string"
      ? (body as { query: string }).query.trim()
      : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const query = await readQuery(request);
  if (!query || query.length > MAX_QUERY_CHARS) {
    return NextResponse.json({ message: "Escribe una búsqueda breve para continuar.", results: [] }, { status: 400 });
  }
  if (hasObviousContactData(query)) {
    return NextResponse.json({ message: "Por tu privacidad, elimina teléfonos, correos u otros datos de contacto antes de usar la ayuda conversacional.", results: [] }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    return NextResponse.json({ message: "La ayuda conversacional no está disponible. Puedes usar la búsqueda normal.", results: [] }, { status: 503 });
  }

  const fingerprint = requestFingerprint(request);
  if (!fingerprint) {
    return NextResponse.json({ message: "La ayuda conversacional no está configurada de forma segura. Usa la búsqueda normal.", results: [] }, { status: 503 });
  }
  if (!isAllowed(fingerprint)) {
    return NextResponse.json({ message: "Has realizado varias búsquedas con ayuda conversacional. Espera unos minutos o usa la búsqueda normal.", results: [] }, { status: 429 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10_000, maxRetries: 0 });
    const instructions = "Eres un asistente de búsqueda humanitaria. No inventes personas, estados ni hechos. Debes llamar exactamente una vez a search_people para cada búsqueda. No uses herramientas web ni conocimiento externo. No incluyas ni solicites teléfonos, correos, direcciones exactas ni datos privados. Después de recibir los resultados, responde solo una oración neutra en español; si no hay resultados, di exactamente: No encontramos coincidencias.";
    const first = await client.responses.create({
      model: process.env.OPENAI_MODEL,
      input: [{ role: "user", content: query }],
      tools: [tool],
      tool_choice: { type: "function", name: "search_people" },
      parallel_tool_calls: false,
      max_output_tokens: 160,
      store: false,
      instructions
    });
    const call = first.output.find((output) => output.type === "function_call");
    if (!call || call.type !== "function_call") return NextResponse.json({ message: "No encontramos coincidencias.", results: [] });

    let args: { name_or_place: string; status: string | null };
    try {
      args = JSON.parse(call.arguments) as { name_or_place: string; status: string | null };
    } catch {
      return NextResponse.json({ message: "No encontramos coincidencias.", results: [] });
    }
    const searchTerm = typeof args.name_or_place === "string" ? args.name_or_place.slice(0, MAX_QUERY_CHARS) : "";
    const status = ["missing", "possibly_trapped", "located_alive", "reunited", "deceased_confirmed"].includes(args.status || "") ? args.status || "" : "";
    const results = await searchCases(searchTerm, { status });
    const safeResults = results.map((result) => ({ id: result.id, name: result.full_name, status: result.condition_status, updated_at: result.updated_at }));
    const second = await client.responses.create({
      model: process.env.OPENAI_MODEL,
      previous_response_id: first.id,
      input: [{ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(safeResults) }],
      max_output_tokens: 120,
      store: false,
      instructions
    });
    const message = results.length ? (second.output_text || `Encontramos ${results.length} coincidencias.`).slice(0, 320) : "No encontramos coincidencias.";
    return NextResponse.json({ message, results });
  } catch {
    return NextResponse.json({ message: "No pudimos completar la búsqueda conversacional. Puedes usar la búsqueda normal.", results: [] }, { status: 503 });
  }
}
