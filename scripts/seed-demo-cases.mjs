/*
 * Creates or refreshes only the 15 fictional demo cases.
 * Requires a Supabase project that already ran the initial migration.
 * It never reads, edits, or deletes non-demo records.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDemoPortraitJpeg, DEMO_PORTRAIT_MAX_BYTES } from "./lib/demo-portrait.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Faltan variables de Supabase para sembrar datos de demostración.");

if (process.env.ENABLE_TEST_DATA !== "true") {
  throw new Error("La siembra ficticia solo se permite con ENABLE_TEST_DATA=true en un entorno de desarrollo o demo.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("No se pueden sembrar personas ficticias con NODE_ENV=production.");
}
if (process.env.DEMO_SEED_CONFIRMATION !== "seed-15-fictional-cases") {
  throw new Error("Confirma que este proyecto es de demostraciÃ³n con DEMO_SEED_CONFIRMATION=seed-15-fictional-cases.");
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false }, realtime: { transport: false } });
const imagePath = "demo/test-supplies.jpg";
const legacyImagePath = "demo/test-supplies.png";
const bucket = "public-portraits";
const imageUrl = supabase.storage.from(bucket).getPublicUrl(imagePath).data.publicUrl;

const seed = [
  ["demo-001", "Valeria Montes Ríos", 29, false, "missing", "moderator_reviewed", "priority", "2026-08-08T23:20:00Z", "Terminal Norte, Ciudad Ejemplo", "Fue reportada separada de su familia durante una evacuación.", 4],
  ["demo-002", "Mateo Salcedo Luna", 11, true, "missing", "moderator_reviewed", "critical", "2026-08-09T15:40:00Z", "Zona aproximada del Refugio Central, Ciudad Ejemplo", "Fue visto por última vez mientras varias familias ingresaban al refugio.", 2],
  ["demo-003", "Ana Lucía Ferrer Gómez", 63, false, "missing", "moderator_reviewed", "priority", "2026-08-07T20:15:00Z", "Mercado del Río, Ciudad Ejemplo", "Su familia perdió contacto con ella después del cierre de varias vías.", 3],
  ["demo-004", "Samuel Ortega Peña", 37, false, "possibly_trapped", "moderator_reviewed", "critical", "2026-08-10T12:30:00Z", "Sector aproximado del Edificio Mirador, Ciudad Ejemplo", "Existen reportes revisados que indican que podría estar en el sector afectado.", 2],
  ["demo-005", "Camila Reyes Navarro", 24, false, "located_alive", "authority_confirmed", "normal", "2026-08-08T17:10:00Z", "Centro de Atención Humanitaria, Ciudad Ejemplo", "Fue localizada con vida y trasladada a un centro de atención.", 5],
  ["demo-006", "Jorge Iván Molina Torres", 52, false, "closed", "moderator_reviewed", "normal", "2026-08-06T00:00:00Z", "Sector Occidental, Ciudad Ejemplo", "Caso ficticio cerrado para pruebas. No representa a una persona real.", 1],
  ["demo-007", "Sofía Cárdenas Gil", 8, true, "reunited", "authority_confirmed", "normal", "2026-08-09T14:25:00Z", "Refugio Infantil, zona aproximada", "Fue localizada y reunida con su familia.", 3],
  ["demo-008", "Diego Andrés Pardo Vélez", 41, false, "missing", "unverified", "priority", "2026-08-11T02:05:00Z", "Estación Sur, Ciudad Ejemplo", "Caso comunitario publicado con información aún no verificada.", 0],
  ["demo-009", "Rosa Elena Benítez Mora", 70, false, "possibly_trapped", "moderator_reviewed", "critical", "2026-08-10T11:45:00Z", "Residencial Los Pinos, zona aproximada", "Existe información revisada que indica que podría estar en una edificación afectada.", 1],
  ["demo-010", "Nicolás Herrera Cruz", 19, false, "missing", "moderator_reviewed", "priority", "2026-08-09T04:10:00Z", "Puente Central, Ciudad Ejemplo", "Varios reportes aprobados lo ubican en diferentes puntos cercanos al puente.", 6],
  ["demo-011", "Mariana López Serrano", 34, false, "missing", "unverified", "priority", "2026-08-11T13:35:00Z", "Ruta de Evacuación 4, Ciudad Ejemplo", "Su familia reportó la pérdida de contacto durante un traslado.", 1],
  ["demo-012", "Andrés Felipe Rincón Díaz", 46, false, "located_alive", "authority_confirmed", "normal", "2026-08-07T22:20:00Z", "Puesto Médico Norte, Ciudad Ejemplo", "Fue localizado con vida y se confirmó su ingreso al puesto médico.", 2],
  ["demo-013", "Gabriela Suárez Nieto", 27, false, "closed", "moderator_reviewed", "normal", "2026-08-06T19:50:00Z", "Distrito Oriental, Ciudad Ejemplo", "Caso ficticio cerrado para pruebas. No representa a una persona real.", 2],
  ["demo-014", "Óscar Medina Quintero", 58, false, "missing", "moderator_reviewed", "priority", "2026-08-10T01:15:00Z", "Parque Industrial, Ciudad Ejemplo", "Fue visto por última vez cerca de un punto de transporte comunitario.", 3],
  ["demo-015", "Luciana Torres Alba", 15, true, "reunited", "authority_confirmed", "normal", "2026-08-08T16:00:00Z", "Centro Juvenil, zona aproximada", "Fue localizada con vida y reunida con su familia.", 4]
].map(([testKey, fullName, age, isMinor, condition, verification, urgency, lastSeen, location, description, count]) => ({ testKey, fullName, age, isMinor, condition, verification, urgency, lastSeen, location, description, count }));

function slug(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function check(error, context) { if (error) throw new Error(`${context}: ${error.message}`); }

const bucketOptions = { public: true, fileSizeLimit: DEMO_PORTRAIT_MAX_BYTES, allowedMimeTypes: ["image/jpeg"] };
const { error: bucketError } = await supabase.storage.createBucket(bucket, bucketOptions);
if (bucketError && !/exist|duplicate/i.test(bucketError.message)) check(bucketError, "No se pudo crear el bucket de retratos de prueba");
const { error: bucketUpdateError } = await supabase.storage.updateBucket(bucket, bucketOptions);
check(bucketUpdateError, "No se pudo asegurar la configuración JPEG del bucket de retratos de prueba");
const sourceImage = await readFile(join(process.cwd(), "data", "test-avatars", "test-supplies.png"));
const image = await createDemoPortraitJpeg(sourceImage);
const { error: uploadError } = await supabase.storage.from(bucket).upload(imagePath, image, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
check(uploadError, "No se pudo subir la imagen sintética");
const { error: legacyImageError } = await supabase.storage.from(bucket).remove([legacyImagePath]);
check(legacyImageError, "No se pudo retirar el retrato PNG legado de demostración");

const { data: people, error: peopleError } = await supabase.from("people").upsert(seed.map((item) => ({ test_key: item.testKey, full_name: item.fullName, approximate_age: item.age, is_minor: item.isMinor, aliases: [], public_description: item.description, is_test_data: true })), { onConflict: "test_key" }).select("id,test_key");
check(peopleError, "No se pudieron crear las personas ficticias");
if (!people || people.length !== seed.length) throw new Error("No se recibieron las 15 personas ficticias esperadas.");
const personIdByKey = new Map(people.map((person) => [person.test_key, person.id]));

const { data: cases, error: casesError } = await supabase.from("cases").upsert(seed.map((item) => ({ person_id: personIdByKey.get(item.testKey), slug: `${item.testKey}-${slug(item.fullName)}`, publication_status: "published", condition_status: item.condition, verification_level: item.verification, urgency_level: item.urgency, last_seen_at: item.lastSeen, last_seen_location_public: item.location, clothing: "Información ficticia para pruebas.", circumstances_public: item.description, primary_public_photo_path: imagePath, published_at: new Date().toISOString() })), { onConflict: "person_id" }).select("id,person_id");
check(casesError, "No se pudieron publicar los casos ficticios");
if (!cases || cases.length !== seed.length) throw new Error("No se recibieron los 15 casos ficticios esperados.");
const caseIds = cases.map((item) => item.id);
const caseIdByPersonId = new Map(cases.map((item) => [item.person_id, item.id]));

const { error: oldReportsError } = await supabase.from("case_reports").delete().in("case_id", caseIds);
check(oldReportsError, "No se pudieron actualizar los avistamientos ficticios");
const { error: oldMediaError } = await supabase.from("media_assets").delete().in("case_id", caseIds);
check(oldMediaError, "No se pudieron actualizar las imágenes ficticias");

const portraitRows = seed.map((item) => ({ case_id: caseIdByPersonId.get(personIdByKey.get(item.testKey)), asset_type: "portrait", storage_bucket: bucket, private_path: imagePath, public_path: imageUrl, original_filename: "test-supplies.jpg", detected_mime_type: "image/jpeg", size_bytes: image.length }));
const { error: mediaError } = await supabase.from("media_assets").insert(portraitRows);
check(mediaError, "No se pudieron registrar las imágenes ficticias");

const reportRows = seed.flatMap((item) => Array.from({ length: item.count }, (_, index) => ({ case_id: caseIdByPersonId.get(personIdByKey.get(item.testKey)), report_type: "sighting", moderation_status: "approved", urgency_level: "normal", event_at: item.lastSeen, location_public: item.location, description: `Avistamiento ficticio aprobado ${index + 1} de ${item.count}.` })));
if (reportRows.length) { const { error: reportsError } = await supabase.from("case_reports").insert(reportRows); check(reportsError, "No se pudieron crear los avistamientos ficticios"); }

console.log(JSON.stringify({ seededPeople: people.length, seededCases: cases.length, approvedDemoSightings: reportRows.length, imageUploaded: true }));
