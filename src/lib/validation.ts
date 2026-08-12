import { z } from "zod";

export const reportSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe el nombre completo.").max(140), approximateAge: z.coerce.number().int().min(0).max(120).optional(),
  lastSeenDate: z.string().min(1, "Indica la fecha aproximada."), lastSeenTime: z.string().optional(), location: z.string().trim().min(3, "Indica un lugar aproximado.").max(240), clothing: z.string().max(800).optional(), features: z.string().max(800).optional(),
  reporterName: z.string().trim().min(2, "Escribe tu nombre.").max(140), phone: z.string().trim().min(7, "Escribe un número de celular válido.").max(40).regex(/^[0-9+\s()-]+$/, "Escribe solo un número de celular válido."), consent: z.literal(true, { errorMap: () => ({ message: "Necesitamos tu consentimiento para procesar el reporte." }) }), goodFaith: z.literal(true, { errorMap: () => ({ message: "Confirma que la información es de buena fe." }) }), website: z.string().max(0).optional()
});

export const informationSchema = z.object({ reportType: z.enum(["sighting", "possible_trapped", "possible_deceased", "correction", "other_information"]), eventAt: z.string().optional(), location: z.string().max(240).optional(), description: z.string().trim().min(10, "Describe la información con un poco más de detalle.").max(3000), consent: z.literal(true), website: z.string().max(0).optional() });
export function validImage(file: File) { return ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024; }
