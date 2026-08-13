"use client";

import { useState } from "react";

export function CopyConfirmationLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return <button className="button secondary" type="button" onClick={copy}>{copied ? "Enlace copiado" : "Copiar enlace"}</button>;
}
