import { createHash } from "node:crypto";

/**
 * Produces a non-reversible, server-only identifier for short abuse windows.
 * Raw IP addresses are never persisted or returned to the client.
 */
export function requestFingerprint(request: Request) {
  // Prefer a separately rotated key. The server-only Supabase key is a safe
  // fallback so reports keep their abuse protection when that optional key has
  // not yet been configured in a deployment.
  const secret = process.env.IP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret && process.env.NODE_ENV === "production") return null;

  const forwarded = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "unknown";

  return createHash("sha256")
    .update(`${secret || "development-only-fingerprint"}:${forwarded.trim()}`)
    .digest("hex");
}

export function hasObviousContactData(text: string) {
  const email = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
  const phone = /(?:\+?\d[\d\s()\-]{6,}\d)/u;
  return email.test(text) || phone.test(text);
}
