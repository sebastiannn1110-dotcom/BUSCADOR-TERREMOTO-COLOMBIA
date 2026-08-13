# Despliegue en Render

Este documento describe el procedimiento. No afirma que la migración, el commit o el deploy estén aplicados en producción.

## 1. Preparar Supabase

Revisa y aplica, en este orden, las cinco migraciones:

1. `202608120001_initial.sql`
2. `202608120002_harden_public_report_submission.sql`
3. `202608120003_fix_report_urgency_and_diagnostics.sql`
4. `202608120004_public_flows_and_official_imports.sql`
5. `202608130001_production_review_and_contact_followups.sql`

Usa `supabase db push` solo después de revisar su diff, o aplica los archivos en SQL Editor respetando el orden. La versión de esquema esperada por el código es `202608130001`.

Comprueba después:

- tablas y RLS, incluida `contact_followups`;
- RPCs públicos y administrativos;
- `report-evidence`: privado, máximo 8 MB, JPG/PNG/WebP;
- `public-portraits`: público, reservado a retratos aprobados;
- perfiles activos con roles `admin`, `moderator` o `responder`;
- que `anon` y `authenticated` no tengan DML directo sobre tablas sensibles.

El endpoint temporal `/api/debug/reports` puede contrastar tablas, RPCs, buckets, RLS, `lastMigrationApplied` y `schemaVersion`. Exige `DEBUG_REPORTS_TOKEN`; elimina esa variable al terminar.

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
APP_URL=https://tu-dominio.example
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

`DEBUG_REPORTS_TOKEN` es temporal. Si no se define, el diagnóstico queda deshabilitado. El flujo actual de seguimiento es manual y no envía mensajería automática.

## 3. Orden de liberación

1. Ejecutar `npm ci`, lint, typecheck, tests, build y E2E en el commit candidato.
2. Revisar y aplicar las cinco migraciones en Supabase.
3. Verificar esquema, RLS, grants y ambos buckets.
4. Crear usuarios de personal y perfiles activos con mínimo privilegio.
5. Subir el commit al repositorio remoto.
6. Esperar el deploy automático o iniciar Manual Deploy.
7. Confirmar en Render que el commit desplegado coincide con el aprobado.
8. Ejecutar smoke tests desde escritorio y teléfono.

## 4. Smoke tests de producción

- `GET /api/health` muestra configuración esperada sin secretos.
- Inicio, `/buscar` y `/fallecidos` cargan únicamente casos publicados.
- Reporte nuevo sin foto y con foto genera recibo y queda pendiente.
- `/admin/personas-pendientes` permite publicar con ubicación pública redactada.
- Aprobar un retrato genera un JPEG público sin exponer el objeto privado.
- `/admin/avistamientos` publica únicamente sightings aprobados y no cambia el estado del caso.
- `/admin/seguimiento-contactos` registra una fila append-only y auditoría.
- Importador de Medicina Legal bloquea referencia vacía y coincidencia ambigua, exige preview y confirmación.
- `responder` tiene lectura pero no controles de escritura.
- Todas las respuestas administrativas sensibles usan `no-store`.

`/api/health` solo comprueba variables; no demuestra que migraciones, RLS, RPCs o buckets existan. Verifícalos por separado.

## 5. Prohibiciones operativas

- No sembrar los 15 casos ficticios en producción.
- No configurar `ENABLE_TEST_DATA=true` en Render.
- No hacer público `report-evidence`.
- No publicar manualmente una ruta de evidencia ni copiar campos privados a una card.
- No confirmar fallecimientos por reportes comunitarios.
- No conservar `DEBUG_REPORTS_TOKEN` después de cerrar el diagnóstico.
