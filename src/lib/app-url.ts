export function appUrlConfiguredCorrectly() {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return false;
  if (raw.toLowerCase().includes("localhost")) return false;

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const localHost = host === "127.0.0.1" || host === "::1";
    return url.protocol === "https:" && !localHost;
  } catch {
    return false;
  }
}
