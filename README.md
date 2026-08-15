# Encontrarnos

Plataforma humanitaria, mobile-first y privada por defecto para buscar personas y recibir información comunitaria después de un desastre. No sustituye a las autoridades, los servicios de emergencia ni los canales oficiales de Medicina Legal.

## Estado del repositorio

El código incluye búsqueda pública, reporte de personas desaparecidas, recepción y moderación de información, revisión y publicación de personas pendientes, seguimiento privado de contactos e importación oficial de fallecidos. Nada en este repositorio demuestra por sí solo que la migración más reciente esté aplicada o que el último commit esté desplegado en producción.

No mezcles personas ficticias con producción. Los datos de prueba solo pueden sembrarse en desarrollo o demo después de establecer explícitamente `ENABLE_TEST_DATA=true`.

## Instalación local

1. Instala Node.js 20.9 o superior y ejecuta `npm install`.
2. Copia `.env.example` a `.env.local` y completa las variables necesarias.
3. Aplica en Supabase, en orden, las nueve migraciones:

   - `supabase/migrations/202608120001_initial.sql`
   - `supabase/migrations/202608120002_harden_public_report_submission.sql`
   - `supabase/migrations/202608120003_fix_report_urgency_and_diagnostics.sql`
   - `supabase/migrations/202608120004_public_flows_and_official_imports.sql`
   - `supabase/migrations/202608130001_production_review_and_contact_followups.sql`
   - `supabase/migrations/202608130002_official_deceased_capture_and_diagnostics.sql`
   - `supabase/migrations/202608130003_admin_case_withdrawal_and_message_threads.sql`
   - `supabase/migrations/202608130004_deceased_memorial_portrait.sql`
   - `supabase/migrations/202608150001_admin_portraits_and_person_imports.sql`

4. Verifica los buckets `report-evidence` —privado— y `public-portraits` —público y reservado a retratos aprobados—.
5. Ejecuta `npm run dev`.

Las migraciones más recientes añaden el flujo de personas pendientes, seguimiento append-only de contactos, promoción segura de retratos, atribución pública controlada, importación oficial idempotente por referencia y fila de origen, diagnóstico agregado y endurecimiento de permisos. El backend convierte todo retrato aprobado a JPEG, corrige orientación, limita dimensiones y elimina metadatos antes de subirlo a `public-portraits`.

## Rutas principales

- Inicio: `/`.
- Buscar casos publicados: `/buscar`.
- Fallecidos confirmados por autoridad: `/fallecidos`.
- Reportar una persona: `/reportar-desaparecido` (`/reportar` redirige allí).
- Enviar información: `/persona/[slug]/informacion`.
- Ver confirmación pública genérica del envío: `/reporte/confirmacion`; la pantalla no muestra el código, no genera enlaces para compartir y usa `noindex, nofollow`. La ruta heredada `/reporte/confirmacion/[trackingCode]` solo valida el formato y redirige a la URL genérica.
- Revisar personas pendientes, gestionar cards publicadas y abrir la bandeja privada de mensajes por caso: `/admin/personas-pendientes`.
- Moderar información: `/admin/avistamientos` (`/admin/posibles-avistamientos` es un alias).
- Registrar seguimiento privado: `/admin/seguimiento-contactos`.
- Importar desaparecidos o fallecidos en CSV/Excel: `/admin/importar-personas`, solo `admin`.
- Importar fallecidos de Medicina Legal: `/admin/importar-fallecidos`, solo `admin`.

Consulta [docs/routes.md](docs/routes.md), [docs/privacy-and-safety.md](docs/privacy-and-safety.md) y [docs/PROJECT_CONTEXT_COMPLETE.md](docs/PROJECT_CONTEXT_COMPLETE.md).

## Privacidad y moderación

Los casos nuevos quedan en `pending_review` y no aparecen públicamente hasta que un `moderator` o `admin` los revise. Contactos, evidencia original, ubicaciones exactas, notas, rutas privadas y referencias de autoridad nunca forman parte del contrato público. Los campos destinados a publicación se redactan de nuevo y rechazan patrones obvios de teléfono o correo.

Los roles activos son:

- `admin`: todas las funciones, incluida la importación oficial de fallecidos.
- `moderator`: revisión de personas, moderación de reportes y escritura de seguimientos.
- `responder`: acceso operativo de solo lectura a colas, contactos y evidencia autorizada.

El primer `admin` se crea una sola vez con el RPC `bootstrap_initial_admin`, restringido a `service_role`, después de crear la cuenta en Supabase Auth. Un perfil admin o el evento histórico impiden reutilizar el bootstrap. Las altas y modificaciones posteriores se realizan con `manage_staff_profile` usando la sesión de un administrador activo. Ambos flujos exigen razón, se serializan para proteger al último administrador y escriben auditoría; nunca hagas `upsert` directo a `profiles`. Los comandos operativos son `npm run staff:bootstrap` y `npm run staff:manage`; consulta [docs/moderation-workflow.md](docs/moderation-workflow.md) antes de usarlos.

Ninguna acción pública cambia el estado de un caso. `deceased_confirmed` es exclusivamente administrativo, exige confirmación de autoridad, justificación y referencia privada, y queda auditado.

## Fotos e importación administrativa

En `/admin/personas-pendientes?seccion=personas`, `admin` y `moderator` pueden subir, cambiar o quitar el retrato de una persona desaparecida o fallecida. El servidor acepta JPG/PNG/WebP hasta 8 MB, valida el contenido, rota, limita el lado mayor a 1200 px y recodifica a JPEG sin conservar EXIF. Actualiza `cases.primary_public_photo_path`, crea el `media_assets` aprobado y escribe `moderation_actions` y `audit_logs`. La misma proyección segura alimenta home, `/buscar`, `/fallecidos` y `/persona/[slug]`; sin retrato actual muestra `Foto no disponible`.

`/admin/importar-personas` acepta `.csv`, `.xlsx` o tabla pegada. Para desaparecidos usa:

```text
source_row,full_name,department_disappearance,municipality_disappearance,source_name,source_reference,public_description
```

Los lugares, edad, sexo y foto nunca se infieren. Una lista `moderator_reviewed` queda en `pending_review`; `authority_confirmed` exige fuente, referencia y confirmación expresa. `person_import_entries` conserva una huella privada para reintentos idempotentes; homónimos y cambios de payload se bloquean.

Para fallecidos, el importador acepta CSV/Excel con:

```text
source_row,reported_unit,full_name,gender,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

`full_name`, `source_name=Medicina Legal` y `source_reference` son obligatorios; edad, género, unidad, lugar y fecha pueden quedar vacíos. La referencia no se publica. El CLI oficial mantiene preview, bloqueo de coincidencias e idempotencia por fuente/fila:

```bash
npm run import:official-deceased -- data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv
```

La lista administrativa de desaparecidos se ejecuta únicamente con confirmación y razón explícitas; crea casos pendientes, no publicados:

```bash
CONFIRM_MISSING_IMPORT=DESAPARECIDOS MISSING_IMPORT_REASON="<razón operativa>" npm run import:missing -- data/imports/desaparecidos-lista-admin-2026-08-15.csv
```

Consulta [docs/importar-fallecidos-medicina-legal.md](docs/importar-fallecidos-medicina-legal.md) y [docs/importar-desaparecidos.md](docs/importar-desaparecidos.md).

## Variables de producción

Configura en Render, sin imprimir ni subir secretos:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_URL=https://buscador-terremoto-colombia.onrender.com
ENABLE_TEST_DATA=false
NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN=<token público del sitio>
CAPTCHA_PROVIDER=turnstile
NEXT_PUBLIC_CAPTCHA_SITE_KEY=...
CAPTCHA_SECRET_KEY=...
IP_HASH_SECRET=<secreto largo y aleatorio>
```

`OPENAI_API_KEY` y `OPENAI_MODEL` son opcionales. `DEBUG_REPORTS_TOKEN` debe ser aleatorio, tener al menos 32 caracteres, habilita un endpoint temporal de diagnóstico y debe retirarse después de la investigación. El endpoint solo expone metadatos de esquema, RLS, migraciones, buckets, conteos públicos agregados y estados `FOUND`/`MISSING`, nunca valores secretos ni filas privadas. `/api/health` informa además `databaseReachable`, `schemaVersion`, `deceasedRouteAvailable` y `appUrlConfiguredCorrectly`.

`NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` es opcional. Si falta, no se renderiza analytics y el build continúa. Si existe, el beacon se limita a `/`, `/fallecidos` sin parámetros y `/privacidad`, con seguimiento SPA desactivado. No se mide `/buscar`, fichas con slug, confirmaciones, formularios ni administración. No hay Google Analytics ni eventos personalizados. Consulta [docs/analytics.md](docs/analytics.md).

Las tres variables CAPTCHA se configuran juntas únicamente si Turnstile está habilitado. Con una `.env` operativa autorizada, `npm run inspect:production` ejecuta una inspección de solo lectura del contrato de producción y devuelve estado agregado, sin imprimir secretos ni filas.

## Datos ficticios: solo demo

Con las nueve migraciones aplicadas en un proyecto separado de demo y `ENABLE_TEST_DATA=true`:

- Ejecuta `supabase/seed.sql` después de `set app.enable_test_data = 'true';`, o
- define `DEMO_SEED_CONFIRMATION=seed-15-fictional-cases` y ejecuta `npm run seed:demo`.

La proyección pública excluye deliberadamente esos registros, incluso en demo. Verifica la siembra desde una consulta administrativa controlada, no desde las RPC públicas.

## Comprobaciones

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Render

Usa un Web Service Node con `npm ci && npm run build` como build command y `npm run start` como start command. Aplica y verifica las nueve migraciones antes del despliegue; luego valida `/api/health`, `/api/debug/reports`, los RPC, ambos buckets y los flujos con roles reales. Aplicar una migración, desplegar un commit e importar datos son acciones independientes. No cargues datos ficticios en producción.

Consulta [docs/render-deployment.md](docs/render-deployment.md) para el procedimiento exacto.
