import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";

export const MEMORIAL_CONFIRMATION = "APPLY_TO_CONFIRMED_DECEASED";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export type MemorialResult = {
  totalConfirmedDeceased: number;
  mediaLinked: number;
  cardsConfigured: number;
};

type MemorialEnvironment = {
  url: string;
  serviceRoleKey: string;
  reason: string;
};

function requireProductionEnvironment(environment: Record<string, string | undefined>): MemorialEnvironment {
  if (environment.CONFIRM_DECEASED_MEMORIAL_IMAGE !== MEMORIAL_CONFIRMATION) {
    throw new Error("CONFIRMATION_REQUIRED");
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const reason = environment.DECEASED_MEMORIAL_REASON?.trim() ?? "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("INVALID_SUPABASE_URL");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.includes("localhost")) {
    throw new Error("INVALID_SUPABASE_URL");
  }
  if (serviceRoleKey.length < 32) throw new Error("SERVICE_ROLE_KEY_MISSING");
  if (reason.length < 10 || reason.length > 1000) throw new Error("INVALID_REASON");
  return { url, serviceRoleKey, reason };
}

export async function sanitizeMemorialImage(sourcePath: string): Promise<Buffer> {
  const source = await readFile(resolve(sourcePath));
  if (source.length < 1 || source.length > MAX_SOURCE_BYTES) throw new Error("INVALID_SOURCE_SIZE");
  const output = await sharp(source, { failOn: "error" })
    .rotate()
    .resize({ width: 900, height: 1350, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const metadata = await sharp(output).metadata();
  if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || output.length > MAX_SOURCE_BYTES) {
    throw new Error("INVALID_SANITIZED_IMAGE");
  }
  return output;
}

function numberField(value: unknown, name: keyof MemorialResult): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`INVALID_RPC_RESULT_${name}`);
  }
  return value;
}

export function parseMemorialResult(value: unknown): MemorialResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RPC_RESULT");
  const record = value as Record<string, unknown>;
  return {
    totalConfirmedDeceased: numberField(record.totalConfirmedDeceased, "totalConfirmedDeceased"),
    mediaLinked: numberField(record.mediaLinked, "mediaLinked"),
    cardsConfigured: numberField(record.cardsConfigured, "cardsConfigured"),
  };
}

export async function applyDeceasedMemorialImage(
  sourcePath: string,
  environment: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<MemorialResult & { assetSha256: string }> {
  const config = requireProductionEnvironment(environment);
  const jpeg = await sanitizeMemorialImage(sourcePath);
  const assetSha256 = createHash("sha256").update(jpeg).digest("hex");
  const publicPath = `memorial/deceased-${assetSha256}.jpg`;
  const authorizationHeaders = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
  const storageResponse = await fetcher(
    `${config.url}/storage/v1/object/public-portraits/${publicPath}`,
    {
      method: "POST",
      headers: {
        ...authorizationHeaders,
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "x-upsert": "true",
      },
      body: new Uint8Array(jpeg),
    },
  );
  if (!storageResponse.ok) throw new Error(`STORAGE_UPLOAD_FAILED_${storageResponse.status}`);

  const publicUrl = `${config.url}/storage/v1/object/public/public-portraits/${publicPath}`;
  const rpcResponse = await fetcher(`${config.url}/rest/v1/rpc/apply_deceased_memorial_portrait`, {
    method: "POST",
    headers: { ...authorizationHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_public_path: publicPath,
      p_public_url: publicUrl,
      p_size_bytes: jpeg.length,
      p_reason: config.reason,
    }),
  });
  const data = await rpcResponse.json().catch(() => null) as unknown;
  if (!rpcResponse.ok) {
    const code = data && typeof data === "object" && !Array.isArray(data) && "code" in data
      ? String((data as { code?: unknown }).code ?? rpcResponse.status)
      : String(rpcResponse.status);
    throw new Error(`RPC_FAILED_${code}`);
  }

  return { ...parseMemorialResult(data), assetSha256 };
}

async function main() {
  const [command, sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !["prepare", "apply"].includes(command ?? "")) {
    throw new Error("USAGE_ERROR");
  }
  if (command === "prepare") {
    if (!outputPath) throw new Error("OUTPUT_PATH_REQUIRED");
    const jpeg = await sanitizeMemorialImage(sourcePath);
    await writeFile(resolve(outputPath), jpeg);
    process.stdout.write(`${JSON.stringify({ status: "prepared", bytes: jpeg.length })}\n`);
    return;
  }

  const result = await applyDeceasedMemorialImage(sourcePath);
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
    process.exitCode = 1;
  });
}
