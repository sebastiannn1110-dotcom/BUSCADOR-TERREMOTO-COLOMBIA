/* Read-only verification. It never prints environment values or secrets. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");

const response = await fetch(`${url}/rest/v1/rpc/search_public_people`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query_text: "", status_filter: null, min_age: null, max_age: null, page_limit: 20, page_offset: 0 })
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  throw new Error(`Supabase no está listo (${response.status}): ${detail.message || "aplica la migración inicial."}`);
}
const cases = await response.json();
if (!Array.isArray(cases)) throw new Error("Supabase devolvió una respuesta pública inesperada.");
if (cases.some((item) => item?.is_test_data === true)) {
  throw new Error("La proyección pública expuso datos marcados como prueba.");
}
console.log(`Conexión pública correcta. Casos publicados visibles: ${cases.length}. Datos de prueba expuestos: 0.`);
