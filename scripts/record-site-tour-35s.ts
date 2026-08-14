import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

const DEFAULT_BASE_URL = "https://buscador-terremoto-colombia.onrender.com";
const VIEWPORT = { width: 390, height: 844 };
const TARGET_TOUR_MS = 30_500;
const artifactsDirectory = path.resolve("artifacts", "videos");
const screenshotsDirectory = path.join(artifactsDirectory, "encontrarnos-tour-35s-screenshots");
const webmPath = path.join(artifactsDirectory, "encontrarnos-tour-35s.webm");
const mp4Path = path.join(artifactsDirectory, "encontrarnos-tour-35s.mp4");
const temporaryVideoDirectory = path.join(artifactsDirectory, ".playwright-video");

function resolveBaseUrl() {
  const candidate = (process.env.VIDEO_TOUR_URL || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname.includes("/admin")) {
    throw new Error("VIDEO_TOUR_URL debe ser una URL pública HTTP(S), sin credenciales ni rutas administrativas.");
  }
  return url.toString().replace(/\/$/, "");
}

async function waitUntil(startedAt: number, offsetMs: number) {
  const remaining = offsetMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(screenshotsDirectory, `${name}.png`), fullPage: false });
}

async function prepareRecordedPage(page: Page) {
  try {
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  } catch {
    // Some development CSPs replace the document during hot reload. The
    // init-script above remains the primary, non-blocking cosmetic guard.
  }
}

async function advanceToStep(page: Page, step: 2 | 3) {
  const button = page.getByRole("button", { name: "Continuar" });
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await button.click();
  const progress = page.getByText(`Paso ${step} de 3`, { exact: true });
  try {
    await progress.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    await page.locator("form.report-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await progress.waitFor({ state: "visible", timeout: 5_000 });
  }
}

async function mediaDurationSeconds(filePath: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(filePath).href, { waitUntil: "domcontentloaded" });
    const video = page.locator("video");
    await video.waitFor({ state: "attached" });
    await page.waitForFunction(() => {
      const element = document.querySelector("video");
      return element instanceof HTMLVideoElement && Number.isFinite(element.duration) && element.duration > 0;
    });
    return await video.evaluate((element) => (element as HTMLVideoElement).duration);
  } finally {
    await browser.close();
  }
}

async function main() {
  const baseUrl = resolveBaseUrl();
  await mkdir(artifactsDirectory, { recursive: true });
  await rm(screenshotsDirectory, { recursive: true, force: true });
  await rm(temporaryVideoDirectory, { recursive: true, force: true });
  await rm(webmPath, { force: true });
  await rm(mp4Path, { force: true });
  await mkdir(screenshotsDirectory, { recursive: true });
  await mkdir(temporaryVideoDirectory, { recursive: true });

  const warmedHtml = new Map<string, string>();
  for (const route of ["/", "/fallecidos", "/reportar-desaparecido"]) {
    const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`No se pudo precalentar la ruta pública ${route}.`);
    warmedHtml.set(route, await response.text());
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: temporaryVideoDirectory, size: VIEWPORT }
  });
  await context.addInitScript(() => {
    const hideDevelopmentIndicator = () => {
      if (document.getElementById("tour-hide-development-indicator")) return;
      const style = document.createElement("style");
      style.id = "tour-hide-development-indicator";
      style.textContent = "nextjs-portal{display:none!important}";
      (document.head || document.documentElement).appendChild(style);
    };
    const observe = () => {
      hideDevelopmentIndicator();
      new MutationObserver(hideDevelopmentIndicator).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  });
  const page = await context.newPage();
  for (const [route, html] of warmedHtml) {
    if (route === "/reportar-desaparecido") continue;
    await page.route(`${baseUrl}${route}`, (requestRoute) => requestRoute.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html
    }));
  }
  let completed = false;
  const forbiddenRequests: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.startsWith("/admin") || (requestUrl.pathname === "/api/reports" && request.method() !== "GET")) {
      forbiddenRequests.push(`${request.method()} ${requestUrl.pathname}`);
    }
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await prepareRecordedPage(page);
    await page.getByRole("heading", { level: 1 }).waitFor();
    const startedAt = Date.now();
    await screenshot(page, "00-home");

    await waitUntil(startedAt, 4_000);
    await page.goto(`${baseUrl}/fallecidos`, { waitUntil: "domcontentloaded" });
    await prepareRecordedPage(page);
    await page.getByRole("heading", { name: "Fallecidos confirmados" }).waitFor();
    const cards = page.locator(".case-card");
    if (await cards.count() < 2) throw new Error("El recorrido necesita al menos dos cards públicas de fallecidos.");
    const columns = await page.locator(".case-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length);
    if (columns !== 2) throw new Error(`La grilla móvil mostró ${columns} columnas; se esperaban 2.`);
    await screenshot(page, "04-fallecidos-dos-columnas");

    await waitUntil(startedAt, 8_000);
    await cards.first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 180);
    await screenshot(page, "08-fallecidos-cards");

    await waitUntil(startedAt, 11_000);
    await page.mouse.wheel(0, 360);
    await screenshot(page, "11-detalle-en-cards");

    await waitUntil(startedAt, 16_000);
    await page.goto(`${baseUrl}/reportar-desaparecido`, { waitUntil: "domcontentloaded" });
    await prepareRecordedPage(page);
    await page.getByRole("heading", { name: "Reportar a una persona desaparecida" }).waitFor();
    // The development CSP blocks the hot-reload socket; give React hydration a
    // deterministic window before exercising the client-side multi-step form.
    await page.waitForTimeout(3_000);
    await page.getByLabel("Nombre completo").fill("Persona de demostración");
    await page.getByLabel("Edad aproximada (opcional)").fill("35");
    await page.getByLabel(/Descripción para identificarla/).fill("Descripción ficticia para mostrar el formulario.");
    await screenshot(page, "16-reporte-persona");

    await waitUntil(startedAt, 21_000);
    await advanceToStep(page, 2);
    await page.getByLabel("Fecha aproximada").fill("2026-08-12");
    await page.getByLabel("Hora aproximada (opcional)").fill("10:30");
    await page.getByLabel("Lugar aproximado").fill("Sector aproximado de demostración");
    await screenshot(page, "21-reporte-lugar");

    await waitUntil(startedAt, 26_000);
    await advanceToStep(page, 3);
    await page.getByText("Contacto para revisión").waitFor();
    await screenshot(page, "26-reporte-contacto-privado");

    await waitUntil(startedAt, 30_000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await screenshot(page, "30-revision-antes-de-publicar");

    await waitUntil(startedAt, TARGET_TOUR_MS);

    if (forbiddenRequests.length) throw new Error(`El recorrido intentó una acción prohibida: ${forbiddenRequests.join(", ")}`);
    completed = true;
  } finally {
    const recordedVideo = page.video();
    await context.close();
    await browser.close();
    if (completed) {
      if (!recordedVideo) throw new Error("Playwright no produjo un archivo de video.");
      await copyFile(await recordedVideo.path(), webmPath);
    }
    await rm(temporaryVideoDirectory, { recursive: true, force: true });
  }

  const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  let mp4Created = false;
  if (!ffmpegCheck.error && ffmpegCheck.status === 0) {
    const conversion = spawnSync("ffmpeg", ["-y", "-i", webmPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4Path], { stdio: "ignore" });
    if (conversion.status !== 0) throw new Error("ffmpeg está disponible, pero no pudo crear el MP4.");
    mp4Created = true;
  }

  const duration = await mediaDurationSeconds(webmPath);
  if (duration < 30 || duration > 35) throw new Error(`El video dura ${duration.toFixed(2)} s; debe durar entre 30 y 35 s.`);
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    baseUrl,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    durationSeconds: Number(duration.toFixed(2)),
    webm: path.relative(process.cwd(), webmPath),
    mp4Created,
    screenshots: path.relative(process.cwd(), screenshotsDirectory),
    submittedReports: 0,
    adminRoutesVisited: 0
  })}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "No se pudo grabar el recorrido.";
  process.stderr.write(`${JSON.stringify({ status: "error", message })}\n`);
  process.exitCode = 1;
});
