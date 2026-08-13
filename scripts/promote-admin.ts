import { createClient } from "@supabase/supabase-js";

type StaffRole = "admin" | "moderator" | "responder";

type CliOptions = {
  userId: string;
  displayName: string;
  reason: string;
  confirm: string;
  role?: StaffRole;
  active?: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_ROLES = new Set<StaffRole>(["admin", "moderator", "responder"]);

function usage(): string {
  return [
    "Uso:",
    "  npm run staff:bootstrap -- --user-id <uuid> --display-name <nombre> --reason <motivo> --confirm bootstrap-initial-admin",
    "  npm run staff:manage -- --user-id <uuid> --display-name <nombre> --role <admin|moderator|responder> --active <true|false> --reason <motivo> --confirm manage-staff-profile",
    "",
    "Bootstrap requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    "Gestión posterior requiere NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY y SUPABASE_ADMIN_ACCESS_TOKEN.",
  ].join("\n");
}

function parseFlags(values: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Argumento inválido: ${flag ?? "(vacío)"}.\n${usage()}`);
    }
    flags[flag.slice(2)] = value;
  }
  return flags;
}

function requireText(flags: Record<string, string>, name: string): string {
  const value = flags[name]?.trim();
  if (!value) throw new Error(`Falta --${name}.\n${usage()}`);
  return value;
}

function parseOptions(values: string[], mode: "bootstrap" | "manage"): CliOptions {
  const flags = parseFlags(values);
  const options: CliOptions = {
    userId: requireText(flags, "user-id"),
    displayName: requireText(flags, "display-name"),
    reason: requireText(flags, "reason"),
    confirm: requireText(flags, "confirm"),
  };

  if (!UUID_PATTERN.test(options.userId)) throw new Error("--user-id debe ser un UUID válido de auth.users.");
  if (options.displayName.length < 2 || options.displayName.length > 120) {
    throw new Error("--display-name debe tener entre 2 y 120 caracteres.");
  }
  if (options.reason.length < 10 || options.reason.length > 1000) {
    throw new Error("--reason debe tener entre 10 y 1000 caracteres y no debe contener secretos.");
  }

  if (mode === "bootstrap") {
    if (options.confirm !== "bootstrap-initial-admin") {
      throw new Error("Bootstrap cancelado: usa --confirm bootstrap-initial-admin tras verificar el UUID.");
    }
    return options;
  }

  const role = requireText(flags, "role") as StaffRole;
  if (!STAFF_ROLES.has(role)) throw new Error("--role debe ser admin, moderator o responder.");
  const active = requireText(flags, "active");
  if (active !== "true" && active !== "false") throw new Error("--active debe ser true o false.");
  if (options.confirm !== "manage-staff-profile") {
    throw new Error("Cambio cancelado: usa --confirm manage-staff-profile tras revisar usuario, rol y estado.");
  }
  return { ...options, role, active: active === "true" };
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable requerida MISSING: ${name}`);
  return value;
}

function safeRpcError(error: { code?: string }): string {
  return JSON.stringify({
    name: "SupabaseRpcError",
    message: "La operación administrativa fue rechazada. Revisa los logs seguros de Supabase usando el código.",
    code: error.code ?? null,
  });
}

async function bootstrap(options: CliOptions) {
  const url = requireEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("bootstrap_initial_admin", {
    p_user_id: options.userId,
    p_display_name: options.displayName,
    p_reason: options.reason,
  });
  if (error) throw new Error(`bootstrap_initial_admin falló: ${safeRpcError(error)}`);
  void data;
  console.log(JSON.stringify({ status: "ok", operation: "bootstrap_initial_admin", audited: true }));
}

async function manage(options: CliOptions) {
  const url = requireEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requireEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const accessToken = requireEnvironment("SUPABASE_ADMIN_ACCESS_TOKEN");
  const supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await supabase.rpc("manage_staff_profile", {
    p_user_id: options.userId,
    p_display_name: options.displayName,
    p_role: options.role,
    p_active: options.active,
    p_reason: options.reason,
  });
  if (error) throw new Error(`manage_staff_profile falló: ${safeRpcError(error)}`);
  void data;
  console.log(JSON.stringify({ status: "ok", operation: "manage_staff_profile", audited: true }));
}

async function main() {
  const [rawMode, ...values] = process.argv.slice(2);
  if (rawMode !== "bootstrap" && rawMode !== "manage") throw new Error(usage());
  const options = parseOptions(values, rawMode);
  if (rawMode === "bootstrap") await bootstrap(options);
  else await manage(options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Error desconocido al gestionar staff.");
  process.exitCode = 1;
});
