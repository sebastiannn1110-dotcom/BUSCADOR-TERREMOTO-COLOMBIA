# Encontrarnos

Plataforma móvil, privada por defecto, para buscar casos humanitarios revisados. No sustituye a las autoridades o servicios de emergencia.

## Antes de publicar

No mezcles personas ficticias con el proyecto de producción. Los 15 casos de prueba se deben cargar únicamente en una base de datos de desarrollo o demostración.

El repositorio no contiene secretos. Si alguna clave se compartió por chat, pantalla o se añadió al repositorio antes, revócala y genera una nueva en Supabase/OpenAI antes de desplegar.

## Instalación local

1. Instala Node 20+ y ejecuta `npm install`.
2. Copia `.env.example` a `.env.local` y completa las variables de servidor.
3. En Supabase SQL Editor ejecuta, en este orden:
   - `supabase/migrations/202608120001_initial.sql`
   - `supabase/migrations/202608120002_harden_public_report_submission.sql`
   - `supabase/migrations/202608120003_fix_report_urgency_and_diagnostics.sql`
4. Crea un bucket privado para evidencia y un bucket público `public-portraits` solo para retratos aprobados. Aplica políticas de Storage que permitan escribir/publicar únicamente a moderadores.
5. Ejecuta `npm run dev`.

La ruta `/api/health` verifica la configuración básica.

## Reportes seguros

Los reportes nuevos quedan en `pending_review`, los teléfonos y ubicaciones se almacenan privados y el navegador muestra un código de seguimiento. Las migraciones 002 y 003 son obligatorias: contienen el RPC `submit_public_report`, el límite de cinco envíos por 15 minutos, el cierre de los RPC públicos antiguos y la corrección de tipos enum de urgencia.

El diagnóstico temporal `GET /api/debug/reports` requiere el encabezado `x-debug-token` con el valor de `DEBUG_REPORTS_TOKEN`. Devuelve únicamente metadatos de esquema, RLS, migraciones, buckets y estados `FOUND`/`MISSING`; nunca devuelve claves, contactos, ubicaciones, filas privadas ni rutas de archivos. Elimina la variable cuando termine la investigación para deshabilitar el endpoint.

Para producción configura en Render:

```text
CAPTCHA_PROVIDER=turnstile
NEXT_PUBLIC_CAPTCHA_SITE_KEY=...
CAPTCHA_SECRET_KEY=...
IP_HASH_SECRET=<secreto largo y aleatorio>
ENABLE_TEST_DATA=false
```

Turnstile es una capa adicional recomendada. Si no se configura por completo, los formularios siguen protegidos por límite de tamaño, honeypot, huella de servidor y límite de cinco envíos por 15 minutos; configura `IP_HASH_SECRET` con un secreto largo y aleatorio para independizar esa huella de la clave de servicio.

## Ayuda con IA

Configura `OPENAI_API_KEY` y `OPENAI_MODEL` únicamente en el servidor. La ayuda conversacional procesa una consulta breve con OpenAI para interpretar la búsqueda de casos públicos; no incluyas teléfonos, correos, direcciones exactas ni otros datos privados. Sin estas variables, la búsqueda normal sigue disponible.

## Datos ficticios: solo demo

Con una base de datos de demo, tras aplicar ambas migraciones y con `ENABLE_TEST_DATA=true`, usa una de estas opciones:

- Ejecuta `supabase/seed.sql` en SQL Editor después de `set app.enable_test_data = 'true';`.
- O, con credenciales de servicio solo en el entorno demo, define `DEMO_SEED_CONFIRMATION=seed-15-fictional-cases` y ejecuta `npm run seed:demo`.

Después ejecuta `npm run verify:supabase`; debe indicar exactamente 15 casos de prueba. El sembrador crea únicamente datos marcados como ficticios y una imagen sintética.

## Comprobaciones

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Render

Configura un Web Service Node con `npm ci && npm run build` como build command y `npm run start` como start command. Copia las variables de `.env.example` en el panel de Render, sin subirlas a Git. Ejecuta las tres migraciones de Supabase antes del despliegue, establece `APP_URL` con la URL HTTPS definitiva y desactiva `ENABLE_TEST_DATA`.

Consulta [docs/render-deployment.md](docs/render-deployment.md), [docs/moderation-workflow.md](docs/moderation-workflow.md) y [docs/privacy-and-safety.md](docs/privacy-and-safety.md) antes de publicar casos reales.
