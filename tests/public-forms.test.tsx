// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { MissingPersonForm } from "@/components/missing-person-form";
import { InformationForm } from "@/components/information-form";
import { SearchResults } from "@/app/buscar/search-results";

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("formularios públicos simplificados", () => {
  it("el formulario de desaparecido conserva tres pasos y elimina campos innecesarios", () => {
    const { container } = render(<MissingPersonForm />);
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument();
    expect(screen.getByLabelText(/Descripción para identificarla/)).toBeInTheDocument();
    expect(screen.queryByText(/Alias o nombre/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/¿Es menor de edad?/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Persona Ficticia" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByText("Paso 2 de 3")).toBeInTheDocument();
    expect(screen.queryByText("Circunstancias")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Fecha aproximada"), { target: { value: "2026-08-12" } });
    fireEvent.change(screen.getByLabelText("Lugar aproximado"), { target: { value: "Sector aproximado" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByText("Paso 3 de 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Tu nombre")).toBeRequired();
    expect(screen.getByLabelText("Número para contactarte")).toBeRequired();
    expect(screen.queryByLabelText(/Correo/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Relación/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Confirmo que esta información es de buena fe/)).toBeRequired();
  });

  it("ofrece seis tipos de información y preselecciona corrección", () => {
    render(<InformationForm caseId="11111111-1111-4111-8111-111111111111" initialKind="correction" />);
    const selector = screen.getByLabelText("Tipo de información") as HTMLSelectElement;
    expect(selector.value).toBe("correction");
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(screen.getByRole("option", { name: "La vi con vida" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Está en un hospital, refugio o punto de atención" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Podría estar atrapada" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tengo información sobre un posible fallecimiento" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Quiero corregir un dato" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Otra información" })).toBeInTheDocument();
  });

  it("exige lugar para avistamientos y teléfono para atención", () => {
    render(<InformationForm caseId="11111111-1111-4111-8111-111111111111" />);
    const location = screen.getByLabelText("Lugar del posible avistamiento o información");
    const phone = screen.getByLabelText(/Tu número para contactarte/);
    expect(location).toBeRequired();
    expect(phone).not.toBeRequired();

    fireEvent.change(screen.getByLabelText("Tipo de información"), { target: { value: "sighting_care" } });
    expect(screen.getByLabelText(/Tu número para contactarte/)).toBeRequired();
    expect(screen.getByText(/Tu número no será público/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirmo que esta información es de buena fe/)).toBeRequired();
  });
});

describe("filtros públicos", () => {
  it("muestra los cinco filtros visibles con URLs estado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }));
    render(<SearchResults initialQuery="" initialStatus="missing" />);
    await waitFor(() => expect(screen.getByText("0 coincidencias")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Todos" })).toHaveAttribute("href", "/buscar");
    expect(screen.getByRole("link", { name: "Desaparecidos" })).toHaveAttribute("href", "/buscar?estado=missing");
    expect(screen.getByRole("link", { name: "Fallecidos confirmados" })).toHaveAttribute("href", "/buscar?estado=deceased_confirmed");
    expect(screen.getByRole("link", { name: "Localizados" })).toHaveAttribute("href", "/buscar?estado=located_alive");
    expect(screen.getByRole("link", { name: "Reunidos" })).toHaveAttribute("href", "/buscar?estado=reunited");
  });

  it("permite navegar páginas de resultados conservando el filtro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [], hasMore: true }) }));
    render(<SearchResults initialQuery="Persona" initialStatus="missing" initialPage="2" />);
    await waitFor(() => expect(screen.getByText("Página 2")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Página anterior" })).toHaveAttribute("href", "/buscar?q=Persona&estado=missing");
    expect(screen.getByRole("link", { name: "Página siguiente" })).toHaveAttribute("href", "/buscar?q=Persona&estado=missing&pagina=3");
  });
});
