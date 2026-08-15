import { expect, test } from "@playwright/test";

const fictionalPublicCase = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "persona-ficticia-e2e",
  full_name: "Persona Ficticia E2E",
  approximate_age: 35,
  is_minor: false,
  condition_status: "missing",
  verification_level: "moderator_reviewed",
  urgency_level: "normal",
  last_seen_at: "2026-08-12T12:00:00Z",
  last_seen_location_public: "Sector público ficticio",
  primary_public_photo_url: null,
  approved_reports_count: 1,
  approved_sightings_count: 1,
  latest_approved_sighting_location: "Parque ficticio",
  updated_at: "2026-08-13T12:00:00Z",
  is_test_data: false
};

test("la home muestra las dos categorías principales en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Encuentra a tu familiar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Desaparecidos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fallecidos confirmados" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver desaparecidos" })).toHaveAttribute("href", "/buscar?estado=missing");
  await expect(page.getByRole("link", { name: "Ver fallecidos confirmados" })).toHaveAttribute("href", "/fallecidos");
});

test("los recursos sintéticos de demo no forman parte del sitio público", async ({ request }) => {
  const response = await request.get("/test-avatars/demo-001.svg");
  expect(response.status()).toBe(404);
});

test("fallecidos responde y ofrece búsqueda pública por nombre", async ({ page }) => {
  const response = await page.goto("/fallecidos");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Fallecidos confirmados" })).toBeVisible();
  await expect(page.getByPlaceholder("Buscar por nombre")).toBeVisible();
  await expect(page.getByText(/Personas identificadas oficialmente/)).toBeVisible();
});

test("la búsqueda usa resultados públicos simulados sin fixtures runtime", async ({ page }) => {
  await page.route("**/api/search?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [fictionalPublicCase] }) });
  });
  await page.goto("/buscar?q=Persona");
  await expect(page.getByText("Persona Ficticia E2E")).toBeVisible();
  await expect(page.getByText("Posibles avistamientos revisados")).toBeVisible();
  await expect(page.getByText("Parque ficticio")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tengo información / La vi" })).toHaveAttribute("href", "/persona/persona-ficticia-e2e/informacion");
  await expect(page.locator("body")).not.toContainText("phone");
  await expect(page.locator("body")).not.toContainText("email");
});

test("los filtros visibles construyen URLs con estado", async ({ page }) => {
  await page.route("**/api/search?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.goto("/buscar?estado=missing");
  await expect(page.getByRole("link", { name: "Todos" })).toHaveAttribute("href", "/buscar");
  await expect(page.getByRole("link", { name: "Desaparecidos" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Fallecidos confirmados" })).toHaveAttribute("href", "/buscar?estado=deceased_confirmed");
  await expect(page.getByRole("link", { name: "Localizados" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reunidos" })).toHaveCount(0);
  await page.getByRole("link", { name: "Fallecidos confirmados" }).click();
  await expect(page).toHaveURL(/\/buscar\?estado=deceased_confirmed$/);
  await expect(page.getByRole("link", { name: "Fallecidos confirmados" })).toHaveAttribute("aria-current", "page");
});

test("el reporte público simplificado conserva foto opcional y tres pasos", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/reportar-desaparecido");
  await expect(page.getByText("Paso 1 de 3")).toBeVisible();
  await expect(page.getByText("Subir foto")).toBeVisible();
  await expect(page.getByText("Tomar foto")).toBeVisible();
  await expect(page.getByText(/Si no tienes una compatible, puedes continuar sin foto/)).toBeVisible();
  await expect(page.getByLabel(/Descripción para identificarla/)).toBeVisible();
  await expect(page.getByText(/Alias o nombre por el que/i)).toHaveCount(0);
  await expect(page.getByText(/¿Es menor de edad?/i)).toHaveCount(0);

  await page.getByLabel("Nombre completo").fill("Persona Ficticia E2E");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Paso 2 de 3")).toBeVisible();
  await expect(page.getByLabel("Lugar aproximado")).toBeVisible();
  await expect(page.getByText("Circunstancias", { exact: true })).toHaveCount(0);

  await page.getByLabel("Fecha aproximada").fill("2026-08-12");
  await page.getByLabel("Lugar aproximado").fill("Sector ficticio");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Paso 3 de 3")).toBeVisible();
  await expect(page.getByLabel("Tu nombre")).toBeVisible();
  await expect(page.getByLabel("Número para contactarte")).toBeVisible();
  await expect(page.getByLabel(/Confirmo que esta información es de buena fe/)).toBeVisible();
  await expect(page.getByText(/Correo/i)).toHaveCount(0);
  await expect(page.getByText(/Relación con la persona/i)).toHaveCount(0);
});

test("la confirmación pública no expone tracking ni enlaces internos", async ({ page }) => {
  await page.goto("/reporte/confirmacion/EN-FICTICIO-123");
  await expect(page).toHaveURL(/\/reporte\/confirmacion$/);
  await expect(page.getByRole("heading", { name: "Reporte recibido" })).toBeVisible();
  await expect(page.getByText(/Si el equipo necesita más información/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Reportar otra persona" })).toHaveAttribute("href", "/reportar-desaparecido");
  await expect(page.locator("main")).not.toContainText("EN-FICTICIO-123");
  await expect(page.locator("main")).not.toContainText("localhost");
  await expect(page.getByText("Copiar enlace", { exact: true })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
