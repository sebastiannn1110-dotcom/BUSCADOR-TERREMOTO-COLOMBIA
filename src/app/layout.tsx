import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";
import { SiteHeader } from "@/components/site-header";
import { brand } from "@/lib/brand";
export const metadata: Metadata = { title: brand.name, description: "Plataforma comunitaria para ayudar a encontrar familiares.", robots: { index: false, follow: false } };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body><a className="skip-link" href="#main">Saltar al contenido</a><SiteHeader /><main id="main">{children}</main><footer><p>{brand.name} reúne información comunitaria con cuidado y respeto.</p><nav aria-label="Información"><a href="/privacidad">Privacidad</a><a href="/correccion">Solicitar corrección</a><a href="/retiro">Solicitar retiro</a></nav><aside className="footer-emergency" role="note"><strong>Información importante</strong><p>{brand.emergencyMessage}</p>{brand.emergencyPhone && <p>Emergencias: <a href={`tel:${brand.emergencyPhone}`}>{brand.emergencyPhone}</a></p>}</aside></footer></body></html>; }
