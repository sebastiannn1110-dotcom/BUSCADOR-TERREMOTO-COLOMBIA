import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalEmail = z.union([z.literal(""), z.string().trim().email("Escribe un correo válido.").max(254)]).optional();
const optionalPhone = z.union([
  z.literal(""),
  z.string().trim().min(7, "Escribe un número de contacto válido.").max(40).regex(/^[0-9+\s()-]+$/, "Escribe solo un número de contacto válido.")
]).optional();

const consentValue = z.preprocess((value) => value === true || value === "true" || value === "on", z.literal(true));
const booleanValue = z.preprocess((value) => value === true || value === "true" || value === "yes", z.boolean());
const optionalAge = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? undefined : value,
  z.coerce.number().int().min(0).max(120).optional()
);

export const reportSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe el nombre completo.").max(140),
  alias: optionalText(120),
  approximateAge: optionalAge,
  isMinor: booleanValue,
  lastSeenDate: z.string().min(1, "Indica la fecha aproximada."),
  lastSeenTime: z.string().optional(),
  location: z.string().trim().min(3, "Indica un lugar aproximado.").max(240),
  clothing: optionalText(800),
  features: optionalText(800),
  circumstances: z.string().trim().min(10, "Describe brevemente las circunstancias.").max(2000),
  reporterName: z.string().trim().min(2, "Escribe tu nombre.").max(140),
  phone: optionalPhone,
  email: optionalEmail,
  relationship: optionalText(120),
  consent: consentValue,
  captchaToken: z.string().max(2048).optional(),
  website: z.string().max(0).optional()
}).superRefine((value, context) => {
  if (!value.phone && !value.email) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Escribe un celular o un correo." });
  }
});

export const informationSchema = z.object({
  reportType: z.enum(["sighting", "possible_trapped", "possible_deceased", "correction", "other_information"]),
  eventAt: z.string().optional(),
  eventDate: z.string().optional(),
  eventTime: z.string().optional(),
  location: optionalText(240),
  description: z.string().trim().min(10, "Describe la información con un poco más de detalle.").max(3000),
  reporterName: optionalText(140),
  phone: optionalPhone,
  email: optionalEmail,
  relationship: optionalText(120),
  consent: consentValue,
  captchaToken: z.string().max(2048).optional(),
  website: z.string().max(0).optional()
}).superRefine((value, context) => {
  if (["possible_trapped", "possible_deceased"].includes(value.reportType) && !value.phone && !value.email) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "La información urgente requiere un celular o un correo de contacto." });
  }
});

export function validImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024;
}
