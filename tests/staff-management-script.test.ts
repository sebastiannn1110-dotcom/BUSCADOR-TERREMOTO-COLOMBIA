import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("gestión auditada de perfiles de staff", () => {
  const script = readFileSync(resolve("scripts/promote-admin.ts"), "utf8");
  const projectContext = readFileSync(resolve("docs/PROJECT_CONTEXT_COMPLETE.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("usa exclusivamente los RPC auditados y no escribe profiles directamente", () => {
    expect(script).toContain('rpc("bootstrap_initial_admin"');
    expect(script).toContain('rpc("manage_staff_profile"');
    expect(script).not.toMatch(/\.from\(["']profiles["']\)/);
    expect(script).not.toMatch(/\.(?:insert|update|upsert)\s*\(/);
    const rpcErrorFormatter = script.slice(
      script.indexOf("function safeRpcError"),
      script.indexOf("async function bootstrap"),
    );
    expect(rpcErrorFormatter).not.toContain("error.details");
    expect(rpcErrorFormatter).not.toContain("error.hint");
    expect(rpcErrorFormatter).not.toContain("error.message");
    expect(script).not.toMatch(/console\.log\([^\n]*result/);
  });

  it("expone comandos distintos para bootstrap y gestión posterior", () => {
    expect(packageJson.scripts["staff:bootstrap"]).toBe("tsx scripts/promote-admin.ts bootstrap");
    expect(packageJson.scripts["staff:manage"]).toBe("tsx scripts/promote-admin.ts manage");
  });

  it("documenta los dos flujos auditados y no afirma que la promoción esté deshabilitada", () => {
    expect(projectContext).toContain("npm run staff:bootstrap");
    expect(projectContext).toContain("bootstrap_initial_admin");
    expect(projectContext).toContain("npm run staff:manage");
    expect(projectContext).toContain("manage_staff_profile");
    expect(projectContext).not.toContain("script local de promoción está deshabilitado");
  });
});
