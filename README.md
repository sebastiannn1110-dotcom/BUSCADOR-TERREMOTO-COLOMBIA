# Encontrarnos

Plataforma humanitaria, mobile-first y privada por defecto para buscar personas y recibir información comunitaria después de un desastre. No sustituye a las autoridades, los servicios de emergencia ni los canales oficiales de Medicina Legal.

## Estado del repositorio

El código incluye búsqueda pública, reporte de personas desaparecidas, recepción y moderación de información, revisión y publicación de personas pendientes, seguimiento privado de contactos e importación oficial de fallecidos. Nada en este repositorio demuestra por sí solo que la migración más reciente esté aplicada o que el último commit esté desplegado en producción.

No mezcles personas ficticias con producción. Los datos de prueba solo pueden sembrarse en desarrollo o demo después de establecer explícitamente `ENABLE_TEST_DATA=true`.

## Instalación local

1. Instala Node.js 20.9 o superior y ejecuta `npm install`.
2. Copia `.env.example` a `.env.local` y completa las variables necesarias.
3. Aplica en Supabase, en orden, las seis migraciones:

   - `supabase/migrations/202608120001_initial.sql`
   - `supabase/migrations/202608120002_harden_public_report_submission.sql`
   - `supabase/migrations/202608120003_fix_report_urgency_and_diagnostics.sql`
   - `supabase/migrations/202608120004_public_flows_and_official_imports.sql`
   - `supabase/migrations/202608130001_production_review_and_contact_followups.sql`
   - `supabase/migrations/202608130002_official_deceased_capture_and_diagnostics.sql`

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
- Revisar personas pendientes: `/admin/personas-pendientes`.
- Moderar información: `/admin/avistamientos` (`/admin/posibles-avistamientos` es un alias).
- Registrar seguimiento privado: `/admin/seguimiento-contactos`.
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

## Importación oficial

Hay dos entradas deliberadamente separadas:

- El importador administrativo web conserva el formato legado de siete columnas:

```text
full_name,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

- La captura controlada entregada para el comunicado usa exclusivamente `data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv`, con 142 filas de origen consecutivas, 1–142, y diez columnas:

```text
source_row,reported_unit,full_name,gender,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

`gender` se conserva como dato de la transcripción, pero no se envía al RPC ni se publica. El CLI realiza preview antes de importar, bloquea revisiones ambiguas y usa la clave compuesta privada `source_reference + source_row` para reintentos idempotentes. Requiere `CONFIRM_OFFICIAL_IMPORT=MEDICINA_LEGAL`, `SUPABASE_ADMIN_ACCESS_TOKEN` y `OFFICIAL_IMPORT_REASON`; no debe ejecutarse contra producción sin autorización operativa expresa.

```bash
npm run import:official-deceased -- data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv
```

Consulta [docs/importar-fallecidos-medicina-legal.md](docs/importar-fallecidos-medicina-legal.md) antes de preparar o ejecutar cualquiera de los dos flujos.

## Variables de producción

Configura en Render, sin imprimir ni subir secretos:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_URL=https://buscador-terremoto-colombia.onrender.com
ENABLE_TEST_DATA=false
CAPTCHA_PROVIDER=turnstile
NEXT_PUBLIC_CAPTCHA_SITE_KEY=...
CAPTCHA_SECRET_KEY=...
IP_HASH_SECRET=<secreto largo y aleatorio>
```

`OPENAI_API_KEY` y `OPENAI_MODEL` son opcionales. `DEBUG_REPORTS_TOKEN` debe ser aleatorio, tener al menos 32 caracteres, habilita un endpoint temporal de diagnóstico y debe retirarse después de la investigación. El endpoint solo expone metadatos de esquema, RLS, migraciones, buckets, conteos públicos agregados y estados `FOUND`/`MISSING`, nunca valores secretos ni filas privadas. `/api/health` informa además `databaseReachable`, `schemaVersion`, `deceasedRouteAvailable` y `appUrlConfiguredCorrectly`.

Las tres variables CAPTCHA se configuran juntas únicamente si Turnstile está habilitado. Con una `.env` operativa autorizada, `npm run inspect:production` ejecuta una inspección de solo lectura del contrato de producción y devuelve estado agregado, sin imprimir secretos ni filas.

## Datos ficticios: solo demo

Con las seis migraciones aplicadas en un proyecto separado de demo y `ENABLE_TEST_DATA=true`:

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

Usa un Web Service Node con `npm ci && npm run build` como build command y `npm run start` como start command. Aplica y verifica las seis migraciones antes del despliegue; luego valida `/api/health`, `/api/debug/reports`, los RPC, ambos buckets y los flujos con roles reales. Aplicar la migración, desplegar el commit e importar el CSV son tres acciones independientes: esta documentación no afirma que alguna ya se haya ejecutado en producción. No cargues datos ficticios en producción.

Consulta [docs/render-deployment.md](docs/render-deployment.md) para el procedimiento exacto.
