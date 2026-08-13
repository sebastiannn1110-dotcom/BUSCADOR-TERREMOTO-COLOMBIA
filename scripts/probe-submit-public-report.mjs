/*
 * Read-only-by-rollback probe: the intentionally invalid kind forces the RPC
 * transaction to abort before any person, case, report, or contact is created.
 * Never print the configured URL or service key.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceKey) {
  throw new Error("The Supabase URL and service role key are required.");
}

const fingerprint = "0".repeat(64);
const response = await fetch(`${url}/rest/v1/rpc/submit_public_report`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "tx=rollback"
  },
  body: JSON.stringify({
    p_payload: {
      kind: "diagnostic_rollback",
      requestFingerprint: fingerprint
    }
  }),
  cache: "no-store"
});

const body = await response.json().catch(() => null);
console.log(JSON.stringify({
  operation: "rpc(\"submit_public_report\", { p_payload })",
  expected: "HTTP 400 with PostgreSQL code 22023 (transaction rolled back)",
  status: response.status,
  preferenceApplied: response.headers.get("preference-applied"),
  body
}, null, 2));

if (response.status !== 400 || body?.code !== "22023") {
  process.exitCode = 1;
}
