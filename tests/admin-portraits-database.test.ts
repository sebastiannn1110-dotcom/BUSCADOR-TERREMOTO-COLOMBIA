import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202608150001_admin_portraits_and_person_imports.sql", "utf8");

describe("migración de retratos e importaciones", () => {
  it("restringe fotos a moderación/admin y registra las tres acciones", () => {
    expect(sql).toContain("not public.is_moderator_or_admin()");
    expect(sql).toContain("'upload_public_portrait'");
    expect(sql).toContain("'replace_public_portrait'");
    expect(sql).toContain("'remove_public_portrait'");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("insert into public.moderation_actions");
  });

  it("publica únicamente el retrato señalado por cases y no rutas privadas", () => {
    const view = sql.slice(sql.indexOf("create or replace view public.public_case_cards"), sql.indexOf("create or replace function public.get_admin_people_cases"));
    expect(view).toContain("m.private_path = c.primary_public_photo_path");
    expect(view).not.toContain("authority_reference_private");
    expect(view).not.toContain("source_reference");
    expect(view).not.toContain("reporter_contacts");
  });

  it("implementa ledger, fingerprint, omisión idempotente y bloqueo de homónimos", () => {
    expect(sql).toContain("create table if not exists public.person_import_entries");
    expect(sql).toContain("alter table public.person_import_entries force row level security");
    expect(sql).toContain("revoke all on table public.person_import_entries from public, anon, authenticated");
    expect(sql).toContain("missing_import_fingerprint");
    expect(sql).toContain("already_imported");
    expect(sql).toContain("homonym_in_file");
    expect(sql).toContain("existing_normalized_name_requires_manual_review");
    expect(sql).toContain("v_skipped := v_skipped + 1");
  });

  it("eleva el diagnóstico seguro a la novena migración", () => {
    expect(sql).toContain("'schemaVersion', '202608150001'");
    expect(sql).toContain("'name', 'person_import_entries'");
    expect(sql).toContain("'name', 'set_public_case_portrait'");
  });
});
