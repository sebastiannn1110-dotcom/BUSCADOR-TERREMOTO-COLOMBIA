/* Read-only verification. It never prints environment values or secrets. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");

const response = await fetch(`${url}/rest/v1/public_case_cards?select=id,full_name,is_test_data&limit=20`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  throw new Error(`Supabase no está listo (${response.status}): ${detail.message || "aplica la migración inicial."}`);
}
const cases = await response.json();
const testCases = cases.filter((item) => item.is_test_data).length;
console.log(`Conexión correcta. Casos públicos: ${cases.length}. Casos de prueba: ${testCases}.`);
if (testCases !== 15) process.exitCode = 2;
