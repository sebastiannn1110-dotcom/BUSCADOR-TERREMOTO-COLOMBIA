import { describe, expect, it } from "vitest";
import {
  OUTPUT_COLUMNS,
  buildOutputRows,
  classifyNameMatch,
  extractPaginationUrls,
  extractRecordsFromHtml,
  isAllowedInternalUrl,
  isPlaceholderImage,
  normalizeName,
  pageIndicatesBlocking,
  parseRobotsTxt,
  rowsToCsv,
  type InputPerson,
  type ScrapedRecord
} from "../scripts/scrape-colombia-te-busca-images";

const input = (inputName: string, inputStatus: "missing" | "deceased" = "missing"): InputPerson => ({ inputName, inputStatus });
const record = (overrides: Partial<ScrapedRecord> = {}): ScrapedRecord => ({
  name: "María José Pérez",
  imageUrl: "https://colombiatebusca.com/media.php?id=portrait&type=thumb",
  sourcePageUrl: "https://colombiatebusca.com/?person=person-1",
  sourceStatusText: "Por localizar · Persona extraviada",
  sourceLocationText: "Cali, Valle del Cauca",
  sourceExtraText: "María José Pérez, por localizar en Cali.",
  imageAlt: "Foto de María José Pérez",
  ...overrides
});

describe("scraper de Colombia te busca", () => {
  it("normaliza tildes, mayúsculas, espacios y signos", () => {
    expect(normalizeName("  María   José-Pérez!!! ")).toBe("maria jose perez");
  });

  it("clasifica una coincidencia exacta", () => {
    expect(classifyNameMatch("María José Pérez", "María José Pérez")).toBe("exact");
  });

  it("clasifica una coincidencia exacta normalizada", () => {
    expect(classifyNameMatch("María José Pérez", "MARIA JOSE PEREZ")).toBe("exact_normalized");
  });

  it("envía coincidencias ambiguas a revisión", () => {
    const rows = buildOutputRows(
      [input("María Fernanda Alejandra Carolina Pérez")],
      [
        record({ name: "María Fernanda Alejandra Carolino Pérez" }),
        record({ name: "María Fernanda Alejandra Caralina Pérez", sourcePageUrl: "https://colombiatebusca.com/?person=person-2" })
      ]
    );
    expect(rows[0]).toMatchObject({ match_confidence: "needs_review", should_import_image: "review" });
  });

  it("marca como conflicto una persona desaparecida que la fuente muestra localizada", () => {
    const rows = buildOutputRows([input("María José Pérez")], [record({ sourceStatusText: "Localizada · Terremoto" })]);
    expect(rows[0]).toMatchObject({ status_conflict: true, should_import_image: "review" });
  });

  it("solo acepta iniciales cuando coinciden exactamente y conserva revisión de contexto", () => {
    expect(classifyNameMatch("N N V C", "N N V C")).toBe("exact");
    expect(classifyNameMatch("N N V C", "N N V D")).toBeNull();
    const rows = buildOutputRows([input("N N V C", "deceased")], [record({ name: "N N V C" })]);
    expect(rows[0].should_import_image).toBe("review");
  });

  it("rechaza logos y placeholders como imágenes importables", () => {
    expect(isPlaceholderImage("https://colombiatebusca.com/asset.php?path=settings/sidebar_logo.png", "Logo")).toBe(true);
    const rows = buildOutputRows([input("María José Pérez")], [record({ imageUrl: "https://colombiatebusca.com/placeholder.png" })]);
    expect(rows[0]).toMatchObject({ image_url: "", should_import_image: "no" });
  });

  it("no asigna la imagen de una tarjeta a otro registro", () => {
    const html = `
      <article class="card"><a href="/?person=1"><img src="/media.php?id=1" alt="Foto de Ana Uno"></a><h2><a href="/?person=1">Ana Uno</a></h2></article>
      <article class="card"><h2><a href="/?person=2">Beatriz Dos</a></h2></article>`;
    const records = extractRecordsFromHtml(html, "https://colombiatebusca.com/?page=3");
    expect(records).toHaveLength(2);
    expect(records[0].imageUrl).toContain("id=1");
    expect(records[1].imageUrl).toBe("");
  });

  it("genera CSV con todas las columnas requeridas", () => {
    const csv = rowsToCsv(buildOutputRows([input("María José Pérez")], [record()]));
    expect(csv.replace(/^\uFEFF/, "").split("\n")[0]).toBe(OUTPUT_COLUMNS.join(","));
  });

  it("no acepta ni descubre enlaces de dominios externos", () => {
    expect(isAllowedInternalUrl("https://example.com/?page=4")).toBe(false);
    const html = `<a href="https://example.com/?page=4">4</a><a href="/?page=5">5</a>`;
    expect(extractPaginationUrls(html, "https://colombiatebusca.com/?page=3")).toEqual(["https://colombiatebusca.com/?page=5"]);
  });

  it("detiene el scraping ante robots restrictivo o señales de bloqueo", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow: /", "/").allowed).toBe(false);
    expect(pageIndicatesBlocking(429, "")).toBe(true);
    expect(pageIndicatesBlocking(200, "<title>Just a moment...</title><div class='cf-chl-test'>Challenge</div>")).toBe(true);
  });
});
