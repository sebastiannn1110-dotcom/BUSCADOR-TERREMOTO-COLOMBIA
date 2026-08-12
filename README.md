# Encontrarnos

Plataforma móvil, privada por defecto, para publicar y buscar casos humanitarios revisados. No sustituye a las autoridades o servicios de emergencia.

## Inicio rápido

1. Instale Node 20+ y ejecute `npm install`.
2. Copie `.env.example` a `.env.local` y complete las variables de Supabase. Nunca exponga `SUPABASE_SERVICE_ROLE_KEY`.
3. En Supabase SQL Editor ejecute `supabase/migrations/202608120001_initial.sql`.
4. Cree buckets privados para evidencia y uno público solo para retratos revisados; aplique políticas de Storage que permitan únicamente a moderadores escribir y publicar paths aprobados.
5. Para la demo local, defina `ENABLE_TEST_DATA=true`, ejecute `npm run generate:avatars` y siembra `supabase/seed.sql` en una sesión con `set app.enable_test_data = 'true';`.
   Después ejecute `npm run verify:supabase`; debe indicar exactamente 15 casos de prueba.
6. Ejecute `npm run dev`. La salud está en `/api/health`.

## Moderación y administrador

Registre primero el usuario con Supabase Auth. Con las variables de servidor cargadas, ejecute `npm run promote:admin -- correo@ejemplo.org`. Consulte `docs/moderation-workflow.md` antes de aprobar reportes o confirmar un fallecimiento.

## IA, pruebas y Render

La ayuda conversacional requiere `OPENAI_API_KEY` y `OPENAI_MODEL`; sin ellas permanece disponible la búsqueda normal. Ejecute `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` y `npm run test:e2e`. Para Render, consulte [docs/render-deployment.md](docs/render-deployment.md).

## Riesgos conocidos

El CAPTCHA es una integración pendiente de proveedor: el servidor falla seguro sin secretos de configuración, pero debe conectarse antes de producción. También se requiere una consola administrativa autenticada completa para operar los flujos de moderación en la aplicación (RLS y modelo de datos ya los restringen en Supabase).
