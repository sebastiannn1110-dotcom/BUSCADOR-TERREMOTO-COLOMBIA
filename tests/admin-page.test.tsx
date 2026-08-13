import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStaffContext } = vi.hoisted(() => ({ getStaffContext: vi.fn() }));

vi.mock("@/lib/supabase/auth-server", () => ({ getStaffContext }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ browserSupabase: () => null }));

import AdminPage from "@/app/admin/page";

describe("panel administrativo en español", () => {
  beforeEach(() => getStaffContext.mockReset());

  it.each([
    ["admin", "Administrador"],
    ["moderator", "Moderador"],
    ["responder", "Respondiente"]
  ])("traduce el rol %s", async (role, label) => {
    getStaffContext.mockResolvedValue({
      staff: { id: "11111111-1111-4111-8111-111111111111", displayName: "Personal ficticio", role }
    });

    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain(`Personal ficticio · ${label}`);
    expect(html).not.toContain(`· ${role}`);
  });
});
