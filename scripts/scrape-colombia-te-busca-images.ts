import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const START_URL = "https://colombiatebusca.com/?page=3";
export const SOURCE_ORIGIN = "https://colombiatebusca.com";
export const USER_AGENT = "EncontrarnosResearchBot/1.0 contacto: admin";
export const OUTPUT_COLUMNS = [
  "input_status",
  "input_name",
  "matched_name",
  "match_confidence",
  "image_url",
  "source_page_url",
  "source_status_text",
  "source_location_text",
  "source_extra_text",
  "status_conflict",
  "should_import_image",
  "reason"
] as const;

export type InputStatus = "missing" | "deceased";
export type MatchConfidence = "exact" | "exact_normalized" | "high_similarity" | "needs_review" | "";
export type ImportDecision = "yes" | "no" | "review";

export type InputPerson = {
  inputStatus: InputStatus;
  inputName: string;
};

export type ScrapedRecord = {
  name: string;
  imageUrl: string;
  sourcePageUrl: string;
  sourceStatusText: string;
  sourceLocationText: string;
  sourceExtraText: string;
  imageAlt: string;
};

export type OutputRow = {
  input_status: InputStatus;
  input_name: string;
  matched_name: string;
  match_confidence: MatchConfidence;
  image_url: string;
  source_page_url: string;
  source_status_text: string;
  source_location_text: string;
  source_extra_text: string;
  status_conflict: boolean;
  should_import_image: ImportDecision;
  reason: string;
};

type RobotsPolicy = {
  allowed: boolean;
  disallowedPaths: string[];
  reason: string;
};

type RunStats = {
  startedAt: string;
  finishedAt: string;
  pagesReviewed: number;
  detailPagesReviewed: number;
  missingInputs: number;
  deceasedInputs: number;
  exactMatches: number;
  normalizedMatches: number;
  highSimilarityMatches: number;
  reviewMatches: number;
  withoutImage: number;
  importableImages: number;
  errors: string[];
  blockedPages: string[];
  warnings: string[];
};

const BLOCKING_STATUS_CODES = new Set([401, 403, 429]);
const PLACEHOLDER_TERMS = [
  "avatar",
  "default",
  "favicon",
  "generic",
  "logo",
  "no-photo",
  "no_photo",
  "placeholder",
  "settings/sidebar",
  "sin-foto",
  "sin_foto"
];

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLocaleLowerCase("en")] ?? entity;
  });
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(tag: string, attribute: string): string {
  const expression = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(expression);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function truncate(value: string, maxLength = 300): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isInitialsOnly(value: string): boolean {
  const tokens = normalizeName(value).split(" ").filter(Boolean);
  return tokens.length >= 2 && tokens.every((token) => token.length === 1);
}

function levenshtein(left: string, right: string): number {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

export function nameSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  const longest = Math.max(normalizedLeft.length, normalizedRight.length);
  return longest === 0 ? 1 : 1 - levenshtein(normalizedLeft, normalizedRight) / longest;
}

function samePrincipalSurname(left: string, right: string): boolean {
  const leftTokens = normalizeName(left).split(" ").filter(Boolean);
  const rightTokens = normalizeName(right).split(" ").filter(Boolean);
  return Boolean(leftTokens.length && rightTokens.length && leftTokens.at(-1) === rightTokens.at(-1));
}

function hasApproximatelySameWordCount(left: string, right: string): boolean {
  const difference = Math.abs(normalizeName(left).split(" ").filter(Boolean).length - normalizeName(right).split(" ").filter(Boolean).length);
  return difference <= 1;
}

export function classifyNameMatch(inputName: string, candidateName: string): MatchConfidence | null {
  const trimmedInput = inputName.trim();
  const trimmedCandidate = candidateName.trim();
  if (!trimmedInput || !trimmedCandidate) return null;
  if (trimmedInput === trimmedCandidate) return "exact";

  const normalizedInput = normalizeName(trimmedInput);
  const normalizedCandidate = normalizeName(trimmedCandidate);
  if (normalizedInput === normalizedCandidate) return "exact_normalized";
  if (isInitialsOnly(trimmedInput) || isInitialsOnly(trimmedCandidate)) return null;
  if (!hasApproximatelySameWordCount(trimmedInput, trimmedCandidate)) return null;
  if (!samePrincipalSurname(trimmedInput, trimmedCandidate)) return null;
  return nameSimilarity(trimmedInput, trimmedCandidate) >= 0.96 ? "high_similarity" : null;
}

export function isAllowedInternalUrl(value: string, disallowedPaths: string[] = []): boolean {
  try {
    const url = new URL(value, SOURCE_ORIGIN);
    if (url.origin !== SOURCE_ORIGIN) return false;
    return !disallowedPaths.some((path) => path !== "/" && url.pathname.startsWith(path));
  } catch {
    return false;
  }
}

export function isPlaceholderImage(imageUrl: string, imageAlt = ""): boolean {
  if (!imageUrl) return true;
  const combined = normalizeName(`${imageUrl} ${imageAlt}`).replace(/\s/g, "-");
  return PLACEHOLDER_TERMS.some((term) => combined.includes(term));
}

export function parseRobotsTxt(content: string, targetPath = "/"): RobotsPolicy {
  const relevantRules: string[] = [];
  let applies = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLocaleLowerCase("en");
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      applies = value === "*" || value.toLocaleLowerCase("en") === USER_AGENT.toLocaleLowerCase("en");
    } else if (applies && field === "disallow" && value) {
      relevantRules.push(value);
    }
  }

  const blockedBy = relevantRules.find((path) => path === "/" || targetPath.startsWith(path));
  return {
    allowed: !blockedBy,
    disallowedPaths: relevantRules,
    reason: blockedBy ? `robots.txt bloquea ${targetPath} mediante ${blockedBy}` : "robots.txt permite la ruta pública solicitada."
  };
}

export function pageIndicatesBlocking(status: number, html: string): boolean {
  if (BLOCKING_STATUS_CODES.has(status)) return true;
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toLocaleLowerCase("es");
  const normalized = html.toLocaleLowerCase("es");
  return title.includes("just a moment")
    || normalized.includes("cf-chl-")
    || normalized.includes("access denied")
    || normalized.includes("verifica que eres humano")
    || normalized.includes("verify you are human");
}

function absoluteInternalUrl(value: string, baseUrl: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    return url.origin === SOURCE_ORIGIN ? url.href : "";
  } catch {
    return "";
  }
}

function extractFirstImage(fragment: string, baseUrl: string): { imageUrl: string; imageAlt: string } {
  const imageTag = fragment.match(/<img\b[^>]*>/i)?.[0] ?? "";
  return {
    imageUrl: absoluteInternalUrl(getAttribute(imageTag, "src"), baseUrl),
    imageAlt: getAttribute(imageTag, "alt")
  };
}

export function extractRecordsFromHtml(html: string, pageUrl: string): ScrapedRecord[] {
  const articles = html.match(/<article\b[^>]*class\s*=\s*["'][^"']*\bcard\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi) ?? [];

  return articles.flatMap((article) => {
    const heading = article.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ?? "";
    const name = stripTags(heading);
    if (!name) return [];
    const detailTag = heading.match(/<a\b[^>]*>/i)?.[0] ?? article.match(/<a\b[^>]*\bhref\s*=\s*["'][^"']*person=[^"']*["'][^>]*>/i)?.[0] ?? "";
    const detailHref = getAttribute(detailTag, "href");
    const sourcePageUrl = absoluteInternalUrl(detailHref, pageUrl) || pageUrl;
    const badges = [...article.matchAll(/<[^>]*class\s*=\s*["'][^"']*\bbadge\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean);
    const meta = [...article.matchAll(/<p\b[^>]*class\s*=\s*["'][^"']*\bmeta\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean);
    const location = meta.find((text) => text.includes("⌖"))?.replace(/^\s*⌖\s*/, "") ?? "";
    const { imageUrl, imageAlt } = extractFirstImage(article, pageUrl);

    return [{
      name,
      imageUrl,
      sourcePageUrl,
      sourceStatusText: badges.join(" · "),
      sourceLocationText: location,
      sourceExtraText: truncate(stripTags(article)),
      imageAlt
    }];
  });
}

export function extractPaginationUrls(html: string, pageUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = getAttribute(match[0], "href");
    const absolute = absoluteInternalUrl(href, pageUrl);
    if (!absolute) continue;
    const url = new URL(absolute);
    if (/^\d+$/.test(url.searchParams.get("page") ?? "")) urls.add(url.href);
  }
  return [...urls];
}

export function mergeDetailRecord(card: ScrapedRecord, html: string): ScrapedRecord {
  const bodyText = stripTags(html);
  if (!normalizeName(bodyText).includes(normalizeName(card.name))) return card;
  const ogImageTag = html.match(/<meta\b[^>]*(?:property|name)\s*=\s*["']og:image["'][^>]*>/i)?.[0] ?? "";
  const ogImage = absoluteInternalUrl(getAttribute(ogImageTag, "content"), card.sourcePageUrl);
  const detailFragment = html.match(/<(?:article|section|div)\b[^>]*class\s*=\s*["'][^"']*(?:person-detail|detail-card|profile)[^"']*["'][^>]*>[\s\S]*?<\/(?:article|section|div)>/i)?.[0] ?? "";
  const detailImage = extractFirstImage(detailFragment, card.sourcePageUrl);
  const imageUrl = detailImage.imageUrl && !isPlaceholderImage(detailImage.imageUrl, detailImage.imageAlt)
    ? detailImage.imageUrl
    : ogImage && !isPlaceholderImage(ogImage)
      ? ogImage
      : card.imageUrl;
  return {
    ...card,
    imageUrl,
    imageAlt: detailImage.imageAlt || card.imageAlt,
    sourceExtraText: truncate(detailFragment ? stripTags(detailFragment) : card.sourceExtraText)
  };
}

function sourceStatus(record: ScrapedRecord): InputStatus | "found" | "unknown" {
  const value = normalizeName(record.sourceStatusText);
  if (/\b(fallecid[oa]s?|muert[oa]s?)\b/.test(value)) return "deceased";
  if (/\b(por localizar|desaparecid[oa]s?|extraviad[oa]s?|reportad[oa]s?)\b/.test(value)) return "missing";
  if (/\b(localizad[oa]s?|encontrad[oa]s?)\b/.test(value)) return "found";
  return "unknown";
}

function emptyOutput(person: InputPerson): OutputRow {
  return {
    input_status: person.inputStatus,
    input_name: person.inputName,
    matched_name: "",
    match_confidence: "",
    image_url: "",
    source_page_url: "",
    source_status_text: "",
    source_location_text: "",
    source_extra_text: "",
    status_conflict: false,
    should_import_image: "no",
    reason: "No se encontró imagen pública confiable en la fuente."
  };
}

export function buildOutputRows(inputs: InputPerson[], records: ScrapedRecord[]): OutputRow[] {
  const statusesByName = new Map<string, Set<InputStatus>>();
  for (const person of inputs) {
    const key = normalizeName(person.inputName);
    const statuses = statusesByName.get(key) ?? new Set<InputStatus>();
    statuses.add(person.inputStatus);
    statusesByName.set(key, statuses);
  }

  return inputs.map((person) => {
    const candidates = records
      .map((record) => ({ record, confidence: classifyNameMatch(person.inputName, record.name) }))
      .filter((candidate): candidate is { record: ScrapedRecord; confidence: Exclude<MatchConfidence, ""> } => Boolean(candidate.confidence))
      .sort((left, right) => {
        const rank: Record<Exclude<MatchConfidence, "">, number> = { exact: 3, exact_normalized: 2, high_similarity: 1, needs_review: 0 };
        return rank[right.confidence] - rank[left.confidence]
          || nameSimilarity(person.inputName, right.record.name) - nameSimilarity(person.inputName, left.record.name);
      });

    if (!candidates.length) return emptyOutput(person);
    const best = candidates[0];
    const equallyStrong = candidates.filter((candidate) => candidate.confidence === best.confidence);
    const ambiguous = equallyStrong.some((candidate) => normalizeName(candidate.record.name) !== normalizeName(best.record.name));
    const inputStatusConflict = (statusesByName.get(normalizeName(person.inputName))?.size ?? 0) > 1;
    const detectedStatus = sourceStatus(best.record);
    const sourceConflict = detectedStatus !== "unknown" && detectedStatus !== person.inputStatus;
    const unresolvedDeceasedStatus = person.inputStatus === "deceased" && detectedStatus !== "deceased";
    const statusConflict = inputStatusConflict || sourceConflict;
    const placeholder = isPlaceholderImage(best.record.imageUrl, best.record.imageAlt);
    const initialsNeedReview = isInitialsOnly(person.inputName) && detectedStatus !== person.inputStatus;
    const needsReview = ambiguous
      || statusConflict
      || unresolvedDeceasedStatus
      || initialsNeedReview
      || best.confidence === "high_similarity";
    const confidence: MatchConfidence = ambiguous ? "needs_review" : best.confidence;

    let decision: ImportDecision = "yes";
    let reason = "Nombre e imagen coinciden claramente dentro del mismo registro público.";
    if (!best.record.imageUrl || placeholder) {
      decision = "no";
      reason = "No se encontró imagen pública confiable en la fuente.";
    } else if (needsReview) {
      decision = "review";
      reason = ambiguous
        ? "Hay más de una coincidencia comparable; requiere revisión humana."
        : statusConflict
          ? "El estado de entrada y el estado visible de la fuente entran en conflicto."
          : unresolvedDeceasedStatus
            ? "La fuente no muestra un estado de fallecimiento; requiere revisión humana."
            : initialsNeedReview
              ? "El registro usa solo iniciales y el contexto no confirma el mismo estado."
              : "La coincidencia es aproximada y requiere revisión humana.";
    }

    return {
      input_status: person.inputStatus,
      input_name: person.inputName,
      matched_name: best.record.name,
      match_confidence: confidence,
      image_url: placeholder ? "" : best.record.imageUrl,
      source_page_url: best.record.sourcePageUrl,
      source_status_text: best.record.sourceStatusText,
      source_location_text: best.record.sourceLocationText,
      source_extra_text: truncate(best.record.sourceExtraText),
      status_conflict: statusConflict,
      should_import_image: decision,
      reason
    };
  });
}

function csvCell(value: string | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: OutputRow[]): string {
  const lines = [OUTPUT_COLUMNS.join(",")];
  for (const row of rows) lines.push(OUTPUT_COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

function readPositiveInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return parsed;
}

function looksLikeHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLocaleLowerCase("en").includes("text/html");
}

async function fetchText(url: string): Promise<{ status: number; text: string; finalUrl: string; contentType: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  return { status: response.status, text, finalUrl: response.url, contentType: response.headers.get("content-type") ?? "" };
}

function createRateLimiter(delayMs: number): () => Promise<void> {
  let lastRequestAt = 0;
  return async () => {
    const waitMs = Math.max(0, delayMs - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
    lastRequestAt = Date.now();
  };
}

async function readNames(path: string, inputStatus: InputStatus): Promise<InputPerson[]> {
  const content = await readFile(path, "utf8");
  return content
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name && !name.startsWith("#"))
    .map((inputName) => ({ inputName, inputStatus }));
}

function nextPageUrl(paginationUrls: string[], currentUrl: string): string | null {
  const currentPage = Number(new URL(currentUrl).searchParams.get("page") ?? "1");
  return paginationUrls
    .map((value) => ({ value, page: Number(new URL(value).searchParams.get("page")) }))
    .filter(({ page }) => Number.isInteger(page) && page > currentPage)
    .sort((left, right) => left.page - right.page)[0]?.value ?? null;
}

function reportMarkdown(stats: RunStats): string {
  const errors = stats.errors.length ? stats.errors.map((error) => `- ${error}`).join("\n") : "- Ninguno.";
  const blocked = stats.blockedPages.length ? stats.blockedPages.map((url) => `- ${url}`).join("\n") : "- Ninguna.";
  const warnings = stats.warnings.length ? stats.warnings.map((warning) => `- ${warning}`).join("\n") : "- Ninguna.";
  return `# Reporte de imágenes: Colombia te busca

- Fecha de inicio: ${stats.startedAt}
- Fecha de finalización: ${stats.finishedAt}
- URL inicial: ${START_URL}
- Páginas de listado revisadas: ${stats.pagesReviewed}
- Páginas de detalle revisadas: ${stats.detailPagesReviewed}
- Nombres de entrada desaparecidos: ${stats.missingInputs}
- Nombres de entrada fallecidos: ${stats.deceasedInputs}
- Coincidencias exactas: ${stats.exactMatches}
- Coincidencias normalizadas: ${stats.normalizedMatches}
- Coincidencias de similitud alta: ${stats.highSimilarityMatches}
- Coincidencias en revisión: ${stats.reviewMatches}
- Personas sin imagen confiable: ${stats.withoutImage}
- Imágenes marcadas como candidatas de alta confianza: ${stats.importableImages}

## Errores

${errors}

## Páginas bloqueadas

${blocked}

## Advertencias

${warnings}

## Revisión humana obligatoria

Este proceso solo conserva URLs públicas para revisión. No descarga masivamente imágenes, no usa reconocimiento facial y no modifica Supabase. Antes de cualquier importación, una persona autorizada debe abrir cada página fuente, confirmar que nombre, imagen y contexto pertenecen al mismo registro, resolver coincidencias aproximadas o conflictos de estado y verificar que la fotografía no sea un logo, banner, ícono genérico o placeholder.

No se usaron Google Images, Bing, redes sociales ni dominios externos como fuentes. La ausencia de coincidencia en las páginas revisadas no demuestra que una persona no exista en el sitio.
`;
}

export async function runScraper(): Promise<{ rows: OutputRow[]; stats: RunStats }> {
  const root = process.cwd();
  const maxPages = readPositiveInteger(process.env.SCRAPE_MAX_PAGES, 20, 1, 20, "SCRAPE_MAX_PAGES");
  const delayMs = readPositiveInteger(process.env.SCRAPE_DELAY_MS, 800, 800, 60_000, "SCRAPE_DELAY_MS");
  const inputs = [
    ...await readNames(resolve(root, "data/input/desaparecidos-nombres.txt"), "missing"),
    ...await readNames(resolve(root, "data/input/fallecidos-nombres.txt"), "deceased")
  ];
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const blockedPages: string[] = [];
  const warnings = ["XLSX no generado: el proyecto no tiene una biblioteca de escritura XLSX instalada."];
  const records: ScrapedRecord[] = [];
  let pagesReviewed = 0;
  let detailPagesReviewed = 0;
  const beforeRequest = createRateLimiter(delayMs);

  await beforeRequest();
  const robotsResponse = await fetchText(`${SOURCE_ORIGIN}/robots.txt`);
  if (robotsResponse.status !== 200) {
    blockedPages.push(`${SOURCE_ORIGIN}/robots.txt`);
    errors.push(`robots.txt respondió HTTP ${robotsResponse.status}; el scraping se detuvo de forma conservadora.`);
  } else {
    const robots = parseRobotsTxt(robotsResponse.text, "/");
    if (!robots.allowed) {
      blockedPages.push(START_URL);
      errors.push(robots.reason);
    } else {
      let currentUrl: string | null = START_URL;
      for (let pageIndex = 0; pageIndex < maxPages && currentUrl; pageIndex += 1) {
        if (!isAllowedInternalUrl(currentUrl, robots.disallowedPaths)) {
          blockedPages.push(currentUrl);
          errors.push(`La URL fue descartada por dominio o robots.txt: ${currentUrl}`);
          break;
        }

        await beforeRequest();
        const page = await fetchText(currentUrl);
        if (pageIndicatesBlocking(page.status, page.text)) {
          blockedPages.push(currentUrl);
          errors.push(`La fuente indicó bloqueo o desafío en ${currentUrl} (HTTP ${page.status}).`);
          break;
        }
        if (page.status !== 200 || !page.contentType.toLocaleLowerCase("en").includes("text/html")) {
          errors.push(`Respuesta inesperada en ${currentUrl}: HTTP ${page.status}, ${page.contentType || "sin content-type"}.`);
          break;
        }

        pagesReviewed += 1;
        const pageRecords = extractRecordsFromHtml(page.text, page.finalUrl);
        records.push(...pageRecords);
        currentUrl = nextPageUrl(extractPaginationUrls(page.text, page.finalUrl), page.finalUrl);
      }

      const uniqueMatchedDetails = new Map<string, ScrapedRecord>();
      for (const record of records) {
        if (!inputs.some((person) => classifyNameMatch(person.inputName, record.name))) continue;
        if (!isAllowedInternalUrl(record.sourcePageUrl, robots.disallowedPaths)) continue;
        uniqueMatchedDetails.set(record.sourcePageUrl, record);
      }

      for (const [detailUrl, card] of uniqueMatchedDetails) {
        await beforeRequest();
        const detail = await fetchText(detailUrl);
        if (pageIndicatesBlocking(detail.status, detail.text)) {
          blockedPages.push(detailUrl);
          errors.push(`La fuente indicó bloqueo o desafío en ${detailUrl} (HTTP ${detail.status}).`);
          break;
        }
        if (detail.status !== 200 || !looksLikeHtml(new Response(detail.text, { headers: { "content-type": detail.contentType } }))) {
          errors.push(`No se pudo revisar el detalle ${detailUrl}: HTTP ${detail.status}.`);
          continue;
        }
        detailPagesReviewed += 1;
        const merged = mergeDetailRecord(card, detail.text);
        const index = records.findIndex((record) => record.sourcePageUrl === detailUrl && record.name === card.name);
        if (index >= 0) records[index] = merged;
      }
    }
  }

  const rows = buildOutputRows(inputs, records);
  const finishedAt = new Date().toISOString();
  const stats: RunStats = {
    startedAt,
    finishedAt,
    pagesReviewed,
    detailPagesReviewed,
    missingInputs: inputs.filter((person) => person.inputStatus === "missing").length,
    deceasedInputs: inputs.filter((person) => person.inputStatus === "deceased").length,
    exactMatches: rows.filter((row) => row.match_confidence === "exact").length,
    normalizedMatches: rows.filter((row) => row.match_confidence === "exact_normalized").length,
    highSimilarityMatches: rows.filter((row) => row.match_confidence === "high_similarity").length,
    reviewMatches: rows.filter((row) => row.should_import_image === "review").length,
    withoutImage: rows.filter((row) => !row.image_url).length,
    importableImages: rows.filter((row) => row.should_import_image === "yes").length,
    errors,
    blockedPages,
    warnings
  };
  const outputDirectory = resolve(root, "artifacts/scraping");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "colombia-te-busca-imagenes.csv"), rowsToCsv(rows), "utf8");
  await writeFile(resolve(outputDirectory, "colombia-te-busca-imagenes.json"), `${JSON.stringify({ metadata: stats, results: rows }, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDirectory, "colombia-te-busca-reporte.md"), reportMarkdown(stats), "utf8");
  return { rows, stats };
}

async function main(): Promise<void> {
  const { stats } = await runScraper();
  console.log(JSON.stringify(stats, null, 2));
  if (stats.blockedPages.length) process.exitCode = 2;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "El scraping falló por un error desconocido.");
    process.exitCode = 1;
  });
}
