import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStaffContext, redirect } = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/supabase/auth-server", () => ({ getStaffContext }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/admin-logout", () => ({ AdminLogout: () => <span /> }));
vi.mock("@/components/contact-followups-queue", () => ({ ContactFollowupsQueue: () => <span /> }));
vi.mock("@/components/official-deceased-importer", () => ({ OfficialDeceasedImporter: () => <span /> }));
vi.mock("@/components/pending-people-queue", () => ({ PendingPeopleQueue: () => <span /> }));
vi.mock("@/components/sightings-queue", () => ({ SightingsQueue: () => <span /> }));

import AdminPage from "@/app/admin/page";
import AdminSightingsPage from "@/app/admin/avistamientos/page";
import ImportDeceasedPage from "@/app/admin/importar-fallecidos/page";
import ImportHelpPage from "@/app/admin/importar-fallecidos/ayuda/page";
import PendingPeoplePage from "@/app/admin/personas-pendientes/page";
import ContactFollowupsPage from "@/app/admin/seguimiento-contactos/page";

type ProtectedPage = {
  name: string;
  loginPath: string;
  render: () => Promise<React.ReactNode>;
  requirement: string;
  requiredRole?: string;
};

const protectedPages: ProtectedPage[] = [
  {
    name: "panel",
    loginPath: "/admin/login?next=/admin",
    render: () => AdminPage(),
    requirement: "una cuenta activa del equipo"
  },
  {
    name: "personas pendientes",
    loginPath: "/admin/login?next=/admin/personas-pendientes",
    render: () => PendingPeoplePage(),
    requirement: "el rol de moderador o administrador",
    requiredRole: "moderator_or_admin"
  },
  {
    name: "importador",
    loginPath: "/admin/login?next=/admin/importar-fallecidos",
    render: () => ImportDeceasedPage(),
    requirement: "el rol de administrador",
    requiredRole: "admin"
  },
  {
    name: "ayuda del importador",
    loginPath: "/admin/login?next=/admin/importar-fallecidos/ayuda",
    render: () => ImportHelpPage(),
    requirement: "el rol de administrador",
    requiredRole: "admin"
  },
  {
    name: "posibles avistamientos",
    loginPath: "/admin/login?next=/admin/avistamientos",
    render: () => AdminSightingsPage(),
    requirement: "una cuenta activa del equipo"
  },
  {
    name: "seguimiento de contactos",
    loginPath: "/admin/login?next=/admin/seguimiento-contactos",
    render: () => ContactFollowupsPage({ searchParams: Promise.resolve({}) }),
    requirement: "una cuenta activa del equipo"
  }
];

describe("autorización de páginas administrativas", () => {
  beforeEach(() => {
    getStaffContext.mockReset();
    redirect.mockReset();
    redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
  });

  it.each(protectedPages)("muestra 403 sin redirigir para una sesión sin permisos: $name", async (page) => {
    getStaffContext.mockResolvedValue({ db: {}, staff: null, authenticated: true });

    const html = renderToStaticMarkup(await page.render());

    expect(html).toContain("Error 403");
    expect(html).toContain("Acceso no autorizado");
    expect(html).toContain(page.requirement);
    expect(html).toContain('href="/admin"');
    expect(redirect).not.toHaveBeenCalled();
    expect(getStaffContext).toHaveBeenCalledWith(...(page.requiredRole ? [page.requiredRole] : []));
  });

  it.each(protectedPages)("mantiene el envío a login cuando no existe sesión: $name", async (page) => {
    getStaffContext.mockResolvedValue({ db: {}, staff: null, authenticated: false });

    await expect(page.render()).rejects.toThrow(`NEXT_REDIRECT:${page.loginPath}`);
    expect(redirect).toHaveBeenCalledWith(page.loginPath);
  });
});
