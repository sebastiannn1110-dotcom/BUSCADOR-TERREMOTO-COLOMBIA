import Link from "next/link";
import { brand } from "@/lib/brand";
export function SiteHeader() { return <header className="site-header"><Link href="/" className="brand" aria-label={`${brand.name}, inicio`}><span className="colombia-flag brand-flag" role="img" aria-label="Bandera de Colombia" />{brand.name}</Link><nav aria-label="Navegación principal"><Link href="/buscar">Buscar</Link><Link href="/reportar">Reportar</Link><Link href="/admin">Moderación</Link></nav></header>; }
