// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PendingPeopleQueue } from "@/components/pending-people-queue";
import { ContactFollowupsQueue } from "@/components/contact-followups-queue";
import { SightingsQueue } from "@/components/sightings-queue";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("revisión administrativa segura", () => {
  it("muestra datos privados al staff pero no los precarga en campos públicos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cases: [{
          caseId: "11111111-1111-4111-8111-111111111111",
          fullName: "Persona Ficticia Pendiente",
          approximateAge: null,
          lastSeenAt: null,
          locationPrivate: "Dirección exacta privada 123",
          distinguishingFeatures: "Descripción privada; llamar 300 123 4567",
          trackingCode: "EN-FICTICIO",
          createdAt: "2026-08-13T12:00:00Z",
          reporterName: "Reportante Ficticio",
          phone: "3001234567",
          evidenceAssets: []
        }]
      })
    }));

    render(<PendingPeopleQueue />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Persona Ficticia Pendiente" })).toBeInTheDocument());
    expect(screen.getByText("Dirección exacta privada 123")).toBeInTheDocument();
    expect(screen.getByLabelText(/Lugar público aproximado/)).toHaveValue("");
    expect(screen.getByLabelText("Descripción pública revisada")).toHaveValue("");
    expect(screen.getByText(/Los campos privados no se copian automáticamente/)).toBeInTheDocument();
  });

  it("lista seguimientos privados y oculta las acciones al rol de consulta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          caseId: "11111111-1111-4111-8111-111111111111",
          reportId: "22222222-2222-4222-8222-222222222222",
          contactId: "33333333-3333-4333-8333-333333333333",
          personName: "Persona Ficticia en Seguimiento",
          caseSlug: "persona-ficticia",
          reportType: "possible_trapped",
          urgencyLevel: "urgent",
          moderationStatus: "pending",
          submittedAt: "2026-08-13T12:00:00Z",
          eventAt: null,
          locationPrivate: "Ubicación privada ficticia",
          descriptionPrivate: "Descripción privada ficticia",
          reporterName: "Informante ficticio",
          phone: "3000000000",
          email: null,
          relationship: null,
          initialContact: null,
          lastFollowupStatus: null,
          nextFollowupAt: null,
          followupCount: 0,
          hasEvidence: false
        }]
      })
    }));

    render(<ContactFollowupsQueue canWrite={false} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Persona Ficticia en Seguimiento" })).toBeInTheDocument());
    expect(screen.getByText("Posible atrapamiento · Pendiente · Urgente")).toBeInTheDocument();
    expect(screen.getByText("Acceso de consulta: solo moderadores y administradores pueden registrar acciones.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar contacto" })).not.toBeInTheDocument();
  });

  it.each([
    ["approved", "Aprobado"],
    ["rejected", "Rechazado"]
  ])("muestra el estado moderado %s con una etiqueta precisa", async (moderationStatus, expectedLabel) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          caseId: "11111111-1111-4111-8111-111111111111",
          reportId: `22222222-2222-4222-8222-${moderationStatus === "approved" ? "222222222222" : "333333333333"}`,
          contactId: "33333333-3333-4333-8333-333333333333",
          personName: `Persona Ficticia ${expectedLabel}`,
          caseSlug: `persona-ficticia-${moderationStatus}`,
          reportType: "sighting",
          urgencyLevel: "normal",
          moderationStatus,
          submittedAt: "2026-08-13T12:00:00Z",
          eventAt: null,
          locationPrivate: "Ubicación privada ficticia",
          descriptionPrivate: "Descripción privada ficticia",
          reporterName: "Informante ficticio",
          phone: "3000000000",
          email: null,
          relationship: null,
          initialContact: null,
          lastFollowupStatus: "requiere_seguimiento",
          nextFollowupAt: "2026-08-14T12:00:00Z",
          followupCount: 1,
          hasEvidence: false
        }]
      })
    }));

    render(<ContactFollowupsQueue canWrite={false} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: `Persona Ficticia ${expectedLabel}` })).toBeInTheDocument());
    expect(screen.getByText(`Posible avistamiento · ${expectedLabel} · Normal`)).toBeInTheDocument();
    expect(screen.queryByText(/En revisión/)).not.toBeInTheDocument();
  });

  it("no ofrece publicar como avistamiento un reporte sensible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reports: [{
          id: "11111111-1111-4111-8111-111111111111",
          caseId: "22222222-2222-4222-8222-222222222222",
          caseSlug: "persona-ficticia",
          personName: "Persona Ficticia Sensible",
          reportType: "possible_deceased",
          moderationStatus: "pending",
          urgencyLevel: "urgent",
          eventAt: null,
          locationPrivate: "Ubicación privada",
          descriptionPrivate: "Información sensible ficticia",
          submittedAt: "2026-08-13T12:00:00Z",
          reporterName: null,
          phone: "3000000000",
          email: null,
          relationship: null,
          hasEvidence: false
        }]
      })
    }));

    render(<SightingsQueue canModerate />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Persona Ficticia Sensible" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Aprobar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar como posible avistamiento público" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escalar" })).toBeInTheDocument();
  });
});
