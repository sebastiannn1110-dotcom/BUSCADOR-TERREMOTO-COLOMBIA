export function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9ñ\s-]/g, " ").replace(/\s+/g, " ").trim();
}
