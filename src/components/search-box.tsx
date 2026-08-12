"use client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
export function SearchBox({ initial = "", large = false }: { initial?: string; large?: boolean }) { const [value, setValue] = useState(initial); const router = useRouter(); function submit(e: FormEvent) { e.preventDefault(); router.push(`/buscar?q=${encodeURIComponent(value)}`); } return <form className={`search-box ${large ? "large" : ""}`} onSubmit={submit}><label className="sr-only" htmlFor="person-search">Nombre de la persona</label><input id="person-search" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Escribe el nombre de la persona" autoComplete="off" /><button className="button" type="submit">Buscar</button></form>; }
