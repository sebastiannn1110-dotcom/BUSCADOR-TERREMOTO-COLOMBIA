import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyImportDefaults, parsePersonImportText, type PersonImportRow } from "@/lib/person-import";

type RpcResponse = { data: unknown; error: { code?: string | null } | null };
export type MissingImportEnvironment = {
  url: string;
  publishableKey: string;
  accessToken: string;
  reason: string;
};

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Variable requerida: ${name}.`);
  return value;
}

export function validateMissingImportEnvironment(environment: NodeJS.ProcessEnv): MissingImportEnvironment {
  if (environment.CONFIRM_MISSING_IMPORT?.trim() !== "DESAPARECIDOS") {
    throw new Error("Importación cancelada: exige CONFIRM_MISSING_IMPORT=DESAPARECIDOS.");
  }
  const url = required(environment, "NEXT_PUBLIC_SUPABASE_URL");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL no es válida."); }
  if (parsed.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("La importación confirmada requiere una URL HTTPS que no sea localhost.");
  }
  const reason = required(environment, "MISSING_IMPORT_REASON");
  if (reason.length < 10 || reason.length > 1000) {
    throw new Error("MISSING_IMPORT_REASON debe tener entre 10 y 1000 caracteres.");
  }
  return {
    url,
    publishableKey: required(environment, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    accessToken: required(environment, "SUPABASE_ADMIN_ACCESS_TOKEN"),
    reason
  };
}

async function rpc(environment: MissingImportEnvironment, name: string, parameters: Record<string, unknown>): Promise<RpcResponse> {
  const response = await fetch(`${environment.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: environment.publishableKey,
      Authorization: `Bearer ${environment.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(parameters)
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const code = body && typeof body === "object" && !Array.isArray(body) && "code" in body
      ? String((body as { code?: unknown }).code || "HTTP_ERROR")
      : `HTTP_${response.status}`;
    return { data: null, error: { code } };
  }
  return { data: body, error: null };
}

export async function runMissingImport(rows: PersonImportRow[], environment: MissingImportEnvironment) {
  const preview = await rpc(environment, "preview_missing_people_import", {
    p_rows: rows,
    p_verification_level: "moderator_reviewed"
  });
  if (preview.error) throw new Error(`La vista previa fue rechazada (code=${preview.error.code || "UNKNOWN"}).`);
  if (!Array.isArray(preview.data) || preview.data.length !== rows.length) {
    throw new Error("La vista previa devolvió una cardinalidad inesperada.");
  }
  const blocked = preview.data.filter((item) => !item || typeof item !== "object"
    || (item as { decision?: unknown }).decision === "review_required").length;
  const alreadyImported = preview.data.filter((item) => item && typeof item === "object"
    && (item as { decision?: unknown }).decision === "already_imported").length;
  console.log(JSON.stringify({ stage: "preview", total: rows.length, blocked, alreadyImported }));
  if (blocked) return { status: "blocked" as const, total: rows.length, blocked, alreadyImported };

  const imported = await rpc(environment, "import_missing_people", {
    p_rows: rows,
    p_verification_level: "moderator_reviewed",
    p_confirmed_official: false,
    p_reason: environment.reason
  });
  if (imported.error) throw new Error(`La importación fue rechazada (code=${imported.error.code || "UNKNOWN"}).`);
  return { status: "ok" as const, result: imported.data };
}

async function main() {
  const environment = validateMissingImportEnvironment(process.env);
  const [filePath, extra] = process.argv.slice(2);
  if (!filePath || extra) throw new Error("Uso: npm run import:missing -- <archivo.csv>");
  const bytes = await readFile(resolve(filePath));
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("El CSV debe estar codificado en UTF-8."); }
  const rows = applyImportDefaults(parsePersonImportText(text, "missing"), "missing", {
    sourceName: "Lista aportada por administrador",
    sourceReference: "Lista de desaparecidos aportada por administrador - 2026-08-15",
    publicDescription: "Persona reportada como desaparecida en lista aportada por administrador."
  });
  const summary = await runMissingImport(rows, environment);
  console.log(JSON.stringify({ stage: "import", ...summary }));
  if (summary.status === "blocked") process.exitCode = 2;
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({
      status: "error",
      message: error instanceof Error ? error.message : "Error desconocido."
    }));
    process.exitCode = 1;
  });
}
