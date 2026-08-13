import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalPhone = z.union([
  z.literal(""),
  z.string().trim().min(7, "Escribe un número de contacto válido.").max(40).regex(/^[0-9+\s()-]+$/, "Escribe solo un número de contacto válido.")
]).optional();
const requiredPhone = z.string().trim().min(7, "Escribe un número de contacto válido.").max(40)
  .regex(/^[0-9+\s()-]+$/, "Escribe solo un número de contacto válido.");

const consentValue = z.preprocess((value) => value === true || value === "true" || value === "on", z.literal(true));
const optionalAge = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? undefined : value,
  z.coerce.number().int().min(0).max(120).optional()
);

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const clockTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const zonedDateTimePattern = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/;

function isRealCalendarDate(value: string) {
  const match = calendarDatePattern.exec(value);
  if (!match) return false;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isValidDateTime(value: string) {
  const match = zonedDateTimePattern.exec(value);
  if (!match || !isRealCalendarDate(match[1])) return false;
  const offset = match[3];
  return !offset || !/^[+-]14:(?!00$)/.test(offset);
}

const requiredCalendarDate = z.string().trim()
  .min(1, "Indica la fecha aproximada.")
  .refine(isRealCalendarDate, "Indica una fecha aproximada válida.");
const optionalCalendarDate = z.string().trim()
  .refine((value) => value === "" || isRealCalendarDate(value), "Indica una fecha válida.")
  .optional();
const optionalClockTime = z.string().trim()
  .refine((value) => value === "" || clockTimePattern.test(value), "Indica una hora válida.")
  .optional();
const optionalDateTime = z.string().trim()
  .refine((value) => value === "" || isValidDateTime(value), "Indica una fecha y hora válidas.")
  .optional();

// No existe una regla de negocio que prohíba fechas futuras: se valida su existencia,
// formato y hora, pero se conservan para que moderación determine su pertinencia.

export const reportSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe el nombre completo.").max(140),
  approximateAge: optionalAge,
  identificationDescription: optionalText(800),
  lastSeenDate: requiredCalendarDate,
  lastSeenTime: optionalClockTime,
  location: z.string().trim().min(3, "Indica un lugar aproximado.").max(240),
  reporterName: z.string().trim().min(2, "Escribe tu nombre.").max(140),
  phone: requiredPhone,
  consent: consentValue,
  captchaToken: z.string().max(2048).optional(),
  website: z.string().max(0).optional()
});

export const informationSchema = z.object({
  reportType: z.enum(["sighting", "possible_trapped", "possible_deceased", "correction", "other_information"]),
  reportContext: z.enum(["sighting_alive", "sighting_care"]).optional(),
  eventAt: optionalDateTime,
  eventDate: optionalCalendarDate,
  eventTime: optionalClockTime,
  location: optionalText(240),
  description: z.string().trim().min(10, "Describe la información con un poco más de detalle.").max(3000),
  phone: optionalPhone,
  consent: consentValue,
  captchaToken: z.string().max(2048).optional(),
  website: z.string().max(0).optional()
}).superRefine((value, context) => {
  if (value.reportType === "sighting" && !value.location) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "Indica el lugar aproximado del posible avistamiento." });
  }
  if (value.reportContext && value.reportType !== "sighting") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reportContext"], message: "El contexto indicado no corresponde al tipo de reporte." });
  }
  if (["possible_trapped", "possible_deceased"].includes(value.reportType)
    || value.reportContext === "sighting_care") {
    if (!value.phone) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Escribe un número para que el equipo pueda contactarte." });
    }
  }
});

export function validImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024;
}
