// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("next/script", () => ({ default: (props: React.ScriptHTMLAttributes<HTMLScriptElement>) => <script {...props} /> }));

import { CloudflareWebAnalytics } from "@/components/cloudflare-web-analytics";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("Cloudflare Web Analytics sin PII", () => {
  it("carga el beacon oficial en una ruta general sin query y desactiva SPA", async () => {
    usePathname.mockReturnValue("/");
    const { container } = render(<CloudflareWebAnalytics token="1234567890abcdefghijklmnopqrstuv" />);
    await waitFor(() => expect(container.querySelector("script")).not.toBeNull());
    const script = container.querySelector("script")!;
    expect(script.getAttribute("src")).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(script.getAttribute("data-cf-beacon")).toBe(JSON.stringify({ token: "1234567890abcdefghijklmnopqrstuv", spa: false }));
  });

  it.each(["/buscar", "/persona/persona-ficticia", "/admin", "/reporte/confirmacion/CODIGO"])(
    "no carga analytics en la ruta sensible %s",
    async (pathname) => {
      usePathname.mockReturnValue(pathname);
      const { container } = render(<CloudflareWebAnalytics token="1234567890abcdefghijklmnopqrstuv" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(container.querySelector("script")).toBeNull();
    }
  );

  it("no carga analytics si la URL general contiene parámetros", async () => {
    usePathname.mockReturnValue("/fallecidos");
    window.history.replaceState({}, "", "/fallecidos?q=Persona+Ficticia");
    const { container } = render(<CloudflareWebAnalytics token="1234567890abcdefghijklmnopqrstuv" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("script")).toBeNull();
  });
});
