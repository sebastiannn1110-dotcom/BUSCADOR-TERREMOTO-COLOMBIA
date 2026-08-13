import { describe, expect, it } from "vitest";
import { normalizeName } from "@/lib/normalize";
import { canSetCondition } from "@/lib/transitions";
import { informationSchema, reportSchema, validImage } from "@/lib/validation";
import { conditionMeta, verificationLabels } from "@/lib/status";
describe("normalización y seguridad", () => {
  it("busca con o sin tildes", () => expect(normalizeName("Valéria  Móntes")).toBe("valeria montes"));
  it("elimina caracteres peligrosos y compacta espacios", () => expect(normalizeName("  Ana <script>  López ")).toBe("ana script lopez"));
  it("no permite fallecimiento sin autoridad", () => expect(canSetCondition("admin", "deceased_confirmed", "authority_confirmed", "razón")).toBe(false));
  it("no permite fallecimiento a un moderador", () => expect(canSetCondition("moderator", "deceased_confirmed", "authority_confirmed", "razón", "fuente")).toBe(false));
  it("permite fallecimiento administrado y auditado", () => expect(canSetCondition("admin", "deceased_confirmed", "authority_confirmed", "razón", "fuente autorizada")).toBe(true));
  it("permite a moderación actualizar estados no mortales", () => expect(canSetCondition("moderator", "located_alive", "moderator_reviewed")).toBe(true));
  it("exige un celular privado para reportar una persona", () => expect(reportSchema.safeParse({ fullName:"Persona Prueba",lastSeenDate:"2026-08-01",location:"Lugar de prueba",reporterName:"Alguien" }).success).toBe(false));
  it("acepta un reporte completo con nombre y celular", () => expect(reportSchema.safeParse({ fullName:"Persona Prueba",lastSeenDate:"2026-08-01",location:"Lugar de prueba",reporterName:"Alguien",phone:"3000000000",consent:true }).success).toBe(true));
  it("exige contacto para posibles fallecimientos sensibles", () => expect(informationSchema.safeParse({ reportType:"possible_deceased",description:"Información de prueba suficiente",phone:"3000000000",consent:true }).success).toBe(true));
  it("solo acepta archivos de imagen seguros y pequeños", () => { expect(validImage({ type:"image/jpeg", size:1024 } as File)).toBe(true); expect(validImage({ type:"image/svg+xml", size:1024 } as File)).toBe(false); expect(validImage({ type:"image/png", size:9 * 1024 * 1024 } as File)).toBe(false); });
  it("tiene texto accesible para todos los estados y verificaciones", () => { expect(Object.keys(conditionMeta)).toHaveLength(6); expect(Object.keys(verificationLabels)).toHaveLength(3); });
});
