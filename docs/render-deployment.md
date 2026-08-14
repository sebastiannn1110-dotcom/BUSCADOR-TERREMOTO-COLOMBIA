# Despliegue en Render

Este documento describe el procedimiento. No afirma que la migración, el commit o el deploy estén aplicados en producción.

## 1. Preparar Supabase

Revisa y aplica, en este orden, las ocho migraciones:

1. `202608120001_initial.sql`
2. `202608120002_harden_public_report_submission.sql`
3. `202608120003_fix_report_urgency_and_diagnostics.sql`
4. `202608120004_public_flows_and_official_imports.sql`
5. `202608130001_production_review_and_contact_followups.sql`
6. `202608130002_official_deceased_capture_and_diagnostics.sql`
7. `202608130003_admin_case_withdrawal_and_message_threads.sql`
8. `202608130004_deceased_memorial_portrait.sql`

En un checkout limpio, autentica y vincula primero el CLI al proyecto correcto con `supabase login` y `supabase link --project-ref <PROJECT_REF>`. Después revisa las migraciones pendientes y usa `supabase db push`. Aplicarlas manualmente en SQL Editor no basta para este procedimiento porque puede dejar `supabase_migrations.schema_migrations` sin la versión que verifica el diagnóstico. La versión esperada por el código es `202608130004`.

Comprueba después:

- tablas y RLS, incluidas `contact_followups` y la bitácora privada `official_deceased_import_entries`;
- la columna pública segura `cases.reported_unit` y su proyección como `reported_unit`;
- RPCs públicos y administrativos;
- `report-evidence`: privado, máximo 8 MB, JPG/PNG/WebP;
- `public-portraits`: público, reservado a retratos aprobados;
- perfiles activos con roles `admin`, `moderator` o `responder`;
- que `anon` y `authenticated` no tengan DML directo sobre tablas sensibles.

El endpoint temporal `/api/debug/reports` puede contrastar tablas, RPCs, buckets, RLS, `lastMigrationApplied`, `schemaVersion`, `publishedCounts` y `deceasedFilterReady`. Exige `DEBUG_REPORTS_TOKEN`; elimina esa variable al terminar. Los conteos son agregados y no exponen personas ni referencias privadas.

Desde una sesión local con `.env` autorizada, `npm run inspect:production` valida en modo de solo lectura el esquema OpenAPI, migración, RLS, buckets, conteos agregados, APP_URL exacta, datos demo desactivados y la configuración condicional de CAPTCHA. No imprime los valores de entorno.

## 2. Configurar Render

Crea un **Web Service Node**, no un servicio Docker:

```text
Build Command: npm ci && npm run build
Start Command: npm run start
```

Usa Node.js 20.9 o superior. Configura las variables en el panel de Render; nunca las guardes en Git ni las imprimas completas.

Obligatorias para los flujos de producción:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_URL=https://buscador-terremoto-colombia.onrender.com
IP_HASH_SECRET=<secreto largo, aleatorio e independiente>
ENABLE_TEST_DATA=false
```

Obligatorias si Turnstile está habilitado:

```text
CAPTCHA_PROVIDER=turnstile
NEXT_PUBLIC_CAPTCHA_SITE_KEY=...
CAPTCHA_SECRET_KEY=...
```

Opcionales:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=...
EMERGENCY_MESSAGE=...
EMERGENCY_PHONE=...
```

`DEBUG_REPORTS_TOKEN` es temporal, aleatorio y debe tener al menos 32 caracteres. Si no se define o es más corto, el diagnóstico queda deshabilitado. El flujo actual de seguimiento es manual y no envía mensajería automática.

`APP_URL` debe conservar exactamente `https://buscador-terremoto-colombia.onrender.com`: sin `localhost`, sin HTTP y sin ruta adicional. `/api/health` debe informar `appUrlConfiguredCorrectly: true`; ese booleano confirma HTTPS y ausencia de un host local, mientras el valor exacto se comprueba por separado en Render.

Las credenciales del CLI de importación no deben quedar persistidas en Render. `SUPABASE_ADMIN_ACCESS_TOKEN`, `OFFICIAL_IMPORT_REASON` y `CONFIRM_OFFICIAL_IMPORT=MEDICINA_LEGAL` se suministran solo en la sesión operativa autorizada y se eliminan al terminar. Nunca uses la service role como token de usuario administrador.

## 3. Orden de liberación

1. Ejecutar `npm ci`, lint, typecheck, tests, build y E2E; revisar y crear el commit candidato.
2. Corregir en Render `APP_URL=https://buscador-terremoto-colombia.onrender.com` y mantener `ENABLE_TEST_DATA=false`.
3. Ejecutar `supabase login`, vincular el proyecto correcto, revisar y aplicar las ocho migraciones con `supabase db push`.
4. Verificar esquema `202608130004`, RLS, grants, ambos buckets, conteos agregados y `deceasedFilterReady: true`.
5. Solo con autorización operativa explícita, ejecutar el CLI controlado descrito en la sección 5 y conservar el resumen agregado como evidencia.
6. Ejecutar `git push origin main` con el commit aprobado.
7. Iniciar Manual Deploy en Render y confirmar que el hash desplegado coincide con `main`.
8. Ejecutar los smoke tests de `/api/health`, `/fallecidos` y `/buscar?estado=deceased_confirmed` desde escritorio y teléfono.

## 4. Smoke tests de producción

- `GET /api/health` muestra `databaseReachable: true`, `schemaVersion: "202608130004"`, `deceasedRouteAvailable: true` y `appUrlConfiguredCorrectly: true`, sin secretos.
- `/api/debug/reports`, con token temporal, muestra la última migración, los conteos agregados `missing`/`deceasedConfirmed`, `deceasedFilterReady: true`, tablas/RLS/RPCs y ambos buckets.
- Inicio y `/buscar` cargan únicamente casos publicados; los filtros visibles de búsqueda son `Todos`, `Desaparecidos` y `Fallecidos confirmados`.
- `/fallecidos` carga únicamente `published` + `deceased_confirmed` + `authority_confirmed`; muestra `public_source_label` y etiqueta la unidad como `Unidad básica / lugar reportado`, nunca como lugar de muerte.
- Reporte nuevo sin foto y con foto recibe del API solo `{ "received": true }` y navega a `/reporte/confirmacion`. La confirmación no muestra tracking, URL ni botón de copia, ofrece solo volver al inicio o reportar otra persona y responde con `noindex, nofollow`. Una URL heredada con tracking redirige a la ruta genérica para quitarlo también de la barra de direcciones.
- `/admin/personas-pendientes` permite publicar con ubicación pública redactada.
- `/admin/personas-pendientes?seccion=personas` permite al admin retirar una card con razón y auditoría, sin borrado físico.
- `/admin/personas-pendientes?seccion=mensajes` agrupa mensajes entrantes e historial privado por caso.
- Aprobar un retrato genera un JPEG público sin exponer el objeto privado.
- `/admin/avistamientos` publica únicamente sightings aprobados y no cambia el estado del caso.
- `/admin/seguimiento-contactos` registra una fila append-only y auditoría.
- Importador de Medicina Legal bloquea referencia vacía y coincidencia ambigua, exige preview y confirmación.
- `responder` tiene lectura pero no controles de escritura.
- Todas las respuestas administrativas sensibles usan `no-store`.

`/api/health` comprueba configuración y hace una consulta segura al snapshot de diagnóstico, pero no sustituye una auditoría de RLS, grants, funciones y buckets. Contrasta también `/api/debug/reports` y Supabase antes de importar.

## 5. Importación controlada de las filas 1–142

El archivo versionado es `data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv`: contiene 142 registros y la cabecera de diez columnas documentada en [importar-fallecidos-medicina-legal.md](importar-fallecidos-medicina-legal.md). Este CLI es distinto del importador web legado de siete columnas.

Antes de ejecutarlo:

1. confirma `schemaVersion = 202608130004`;
2. obtiene una sesión vigente de un perfil `admin` y úsala como `SUPABASE_ADMIN_ACCESS_TOKEN`;
3. define una razón operacional de 10–1000 caracteres en `OFFICIAL_IMPORT_REASON`;
4. establece `CONFIRM_OFFICIAL_IMPORT=MEDICINA_LEGAL` solo después de recibir autorización expresa;
5. revisa que `NEXT_PUBLIC_SUPABASE_URL` y la clave publicable apunten al proyecto correcto.

Ejecuta una sola vez desde el commit aprobado:

```bash
npm run import:official-deceased -- data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv
```

El comando ejecuta primero `preview_official_deceased_import`; si hay `reviewRequired`, se detiene sin llamar al RPC de importación. Una coincidencia solo por nombre siempre requiere revisión manual y nunca actualiza un caso. Si no hay bloqueos, llama a `import_official_deceased` y registra únicamente resúmenes agregados. El total final debe ser 142 entre `created` y `alreadyImported`, con `updated = 0`. Repetir exactamente el archivo es idempotente por `source_reference + source_row` y una huella canónica privada; cambiar el contenido con la misma clave se bloquea. Cada repetición sigue requiriendo autorización y credenciales vigentes.

Después, elimina las variables transitorias, revisa `/fallecidos`, el conteo agregado y la auditoría administrativa. No proyectes `source_reference` en UI/API/logs públicos ni la copies fuera del artefacto operativo versionado; nunca copies el token.

## 6. Prohibiciones operativas

- No sembrar los 15 casos ficticios en producción.
- No configurar `ENABLE_TEST_DATA=true` en Render.
- No hacer público `report-evidence`.
- No publicar manualmente una ruta de evidencia ni copiar campos privados a una card.
- No confirmar fallecimientos por reportes comunitarios.
- No ejecutar el CSV oficial sin autorización expresa ni cambiar `source_row` para forzar un reintento.
- No guardar `SUPABASE_ADMIN_ACCESS_TOKEN`, `OFFICIAL_IMPORT_REASON` o `CONFIRM_OFFICIAL_IMPORT` en Git ni como variables persistentes de Render.
- No conservar `DEBUG_REPORTS_TOKEN` después de cerrar el diagnóstico.

## 7. Secuencia pendiente para este cambio

Este es el orden operativo explícito; la presencia de estas instrucciones no significa que ya se haya ejecutado:

1. Corregir en Render `APP_URL=https://buscador-terremoto-colombia.onrender.com` y mantener `ENABLE_TEST_DATA=false`.
2. Desde un entorno autenticado contra el proyecto Supabase correcto, revisar el diff y ejecutar `supabase db push`; comprobar `schemaVersion = 202608130004` antes de continuar.
3. Solo si existe autorización formal, preparar las variables efímeras y ejecutar `npm run import:official-deceased -- data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv`.
4. Ejecutar `git push origin main` con el commit ya validado.
5. En Render, iniciar **Manual Deploy** del hash exacto de `main` y esperar que termine correctamente.
6. Probar `https://buscador-terremoto-colombia.onrender.com/api/health` y verificar los cuatro estados esperados de la sección 4.
7. Probar `https://buscador-terremoto-colombia.onrender.com/fallecidos` y confirmar que las cards provienen del RPC público de Supabase.
8. Probar `https://buscador-terremoto-colombia.onrender.com/buscar?estado=deceased_confirmed` y confirmar que la UI no ofrece filtros de localizados o reunidos.
