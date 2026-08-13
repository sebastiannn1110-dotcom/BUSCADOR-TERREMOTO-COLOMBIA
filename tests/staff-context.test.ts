import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookies, createServerClient, getUser, maybeSingle } = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn()
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { getStaffContext } from "@/lib/supabase/auth-server";

const userId = "11111111-1111-4111-8111-111111111111";

describe("contexto de autorización del equipo", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
    getUser.mockReset();
    maybeSingle.mockReset();
    createServerClient.mockReturnValue({
      auth: { getUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle }))
        }))
      }))
    });
  });

  it("distingue una sesión autenticada cuyo rol no alcanza el requerido", async () => {
    getUser.mockResolvedValue({ data: { user: { id: userId } } });
    maybeSingle.mockResolvedValue({
      data: { id: userId, display_name: "Respondiente ficticio", role: "responder", active: true },
      error: null
    });

    await expect(getStaffContext("admin")).resolves.toMatchObject({
      authenticated: true,
      staff: null
    });
  });

  it("marca como no autenticada una solicitud sin usuario", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(getStaffContext()).resolves.toMatchObject({
      authenticated: false,
      staff: null
    });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("conserva el contexto completo cuando el rol sí está autorizado", async () => {
    getUser.mockResolvedValue({ data: { user: { id: userId } } });
    maybeSingle.mockResolvedValue({
      data: { id: userId, display_name: "Administradora ficticia", role: "admin", active: true },
      error: null
    });

    await expect(getStaffContext("admin")).resolves.toMatchObject({
      authenticated: true,
      staff: { id: userId, displayName: "Administradora ficticia", role: "admin" }
    });
  });
});
