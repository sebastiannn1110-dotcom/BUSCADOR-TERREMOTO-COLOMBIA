import { expect, test } from "@playwright/test";
test("busca y abre un caso de demostración", async ({ page }) => { const searchResponse = page.waitForResponse((response) => response.url().includes("/api/search") && response.request().method() === "GET" && response.status() === 200); await page.goto("/buscar?q=Valeria"); await searchResponse; await expect(page.getByText("Valeria Montes Ríos")).toBeVisible(); await page.getByRole("link", { name: /Ver caso de Valeria/ }).click(); await expect(page.getByRole("heading", { name: "Valeria Montes Ríos" })).toBeVisible(); });
test("la navegación funciona en móvil", async ({ page }) => { await page.setViewportSize({ width: 320, height: 700 }); await page.goto("/"); await expect(page.getByRole("heading", { name: "Encuentra a tu familiar" })).toBeVisible(); });

test("el reporte público muestra foto opcional y tres pasos en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/reportar-desaparecido");
  await expect(page.getByText("Paso 1 de 3")).toBeVisible();
  await expect(page.getByText("Subir foto")).toBeVisible();
  await expect(page.getByText("Tomar foto")).toBeVisible();
  await expect(page.getByText(/Si no tienes foto, puedes continuar/)).toBeVisible();
  await page.getByLabel("Nombre completo").fill("Persona Ficticia E2E");
  await page.getByRole("radio", { name: "No", exact: true }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Paso 2 de 3")).toBeVisible();
  await expect(page.getByLabel("Lugar aproximado")).toBeVisible();
});

test("la ficha enlaza el formulario de información y protege avistamientos", async ({ page }) => {
  await page.goto("/persona/valeria-montes-rios");
  await expect(page.getByRole("heading", { name: "Avistamientos reportados" })).toBeVisible();
  await expect(page.getByText("No hay avistamientos públicos aprobados todavía.")).toBeVisible();
  await page.getByRole("link", { name: "Enviar información" }).click();
  await expect(page.getByRole("heading", { name: /Enviar información sobre Valeria/ })).toBeVisible();
  await expect(page.getByLabel("Adjuntar evidencia (opcional)")).toBeAttached();
});
