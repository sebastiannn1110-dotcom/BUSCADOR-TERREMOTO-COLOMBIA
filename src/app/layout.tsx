import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";
import "./workflows.css";
import { CloudflareWebAnalytics } from "@/components/cloudflare-web-analytics";
import { SiteHeader } from "@/components/site-header";
import { brand } from "@/lib/brand";
export const metadata: Metadata = { title: brand.name, description: "Plataforma comunitaria para ayudar a encontrar familiares.", icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], shortcut: "/icon.svg" }, robots: { index: false, follow: false } };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const analyticsToken = process.env.NODE_ENV !== "test"
    && /^[A-Za-z0-9_-]{20,128}$/u.test(process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN?.trim() || "")
    ? process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN!.trim()
    : null;
  return <html lang="es"><body><a className="skip-link" href="#main">Saltar al contenido</a><SiteHeader /><main id="main">{children}</main><footer><p>{brand.name} reúne información comunitaria con cuidado y respeto.</p><nav aria-label="Información"><a href="/privacidad">Privacidad</a><a href="/correccion">Solicitar corrección</a><a href="/retiro">Solicitar retiro</a></nav><aside className="footer-emergency" role="note"><strong>Información importante</strong><p>{brand.emergencyMessage}</p>{brand.emergencyPhone && <p>Emergencias: <a href={`tel:${brand.emergencyPhone}`}>{brand.emergencyPhone}</a></p>}</aside></footer>{analyticsToken && <CloudflareWebAnalytics token={analyticsToken} />}</body></html>;
}
