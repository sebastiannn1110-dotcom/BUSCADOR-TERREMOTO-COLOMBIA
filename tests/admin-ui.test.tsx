// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PendingPeopleQueue } from "@/components/pending-people-queue";
import { ContactFollowupsQueue } from "@/components/contact-followups-queue";
import { SightingsQueue } from "@/components/sightings-queue";
import { AdminPeopleManager } from "@/components/admin-people-manager";
import { CaseMessageInbox } from "@/components/case-message-inbox";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("revisión administrativa segura", () => {
  it("ofrece retiro lógico con razón y confirmación solo al administrador", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ people: [{
        caseId: "11111111-1111-4111-8111-111111111111",
        slug: "persona con espacios-ficticia",
        fullName: "Persona Ficticia Publicada",
        approximateAge: 52,
        conditionStatus: "missing",
        verificationLevel: "moderator_reviewed",
        publicationStatus: "published",
        reportedUnit: null,
        publicLocation: "Sector ficticio",
        publishedAt: "2026-08-13T12:00:00Z",
        withdrawnAt: null,
        updatedAt: "2026-08-13T12:00:00Z"
      }] })
    }));

    render(<AdminPeopleManager canWithdraw />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Persona Ficticia Publicada" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Abrir ficha pública" })).toHaveAttribute("href", "/persona/persona%20con%20espacios-ficticia");
    expect(screen.getByLabelText("Razón obligatoria del retiro")).toBeRequired();
    expect(screen.getByLabelText(/Confirmo que esta persona/)).toBeRequired();
    expect(screen.getByRole("button", { name: "Retirar del buscador" })).toBeInTheDocument();
    expect(screen.getByText("Foto no disponible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir foto" })).toBeInTheDocument();
  });

  it("muestra mensajes web y el historial interno agrupados por caso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ threads: [{
        caseId: "11111111-1111-4111-8111-111111111111",
        caseSlug: "persona-ficticia",
        personName: "Persona Ficticia con Mensajes",
        conditionStatus: "missing",
        publicationStatus: "published",
        latestMessageAt: "2026-08-13T12:00:00Z",
        messages: [{
          reportId: "22222222-2222-4222-8222-222222222222",
          reportType: "correction",
          reportContext: null,
          moderationStatus: "pending",
          urgencyLevel: "normal",
          submittedAt: "2026-08-13T12:00:00Z",
          eventAt: null,
          descriptionPrivate: "Mensaje privado enviado desde la web.",
          locationPrivate: null,
          contactId: "33333333-3333-4333-8333-333333333333",
          reporterName: "Informante Ficticio",
          phone: "3000000000",
          email: null,
          relationship: "Familiar",
          preferredContactMethod: "llamada",
          hasEvidence: false
        }],
        followups: [{
          followupId: "44444444-4444-4444-8444-444444444444",
          reportId: "22222222-2222-4222-8222-222222222222",
          contactId: "33333333-3333-4333-8333-333333333333",
          targetType: "informante",
          contactMethod: "llamada",
          contactStatus: "contactado",
          summaryPrivate: "Se verificó el mensaje con el informante.",
          nextFollowupAt: null,
          createdAt: "2026-08-13T13:00:00Z"
        }]
      }] })
    }));

    render(<CaseMessageInbox />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Persona Ficticia con Mensajes" })).toBeInTheDocument());
    expect(screen.getByText("Mensaje privado enviado desde la web.")).toBeInTheDocument();
    expect(screen.getByText("Se verificó el mensaje con el informante.")).toBeInTheDocument();
    expect(screen.getByText("3000000000")).toBeInTheDocument();
    expect(screen.getByText(/nunca se muestran a otros usuarios/i)).toBeInTheDocument();
  });

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
