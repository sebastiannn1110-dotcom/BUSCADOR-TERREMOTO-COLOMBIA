# Despliegue en Render

1. Crea un **Web Service** Node conectado al repositorio.
2. Usa `npm ci && npm run build` como Build Command y `npm run start` como Start Command.
3. En Supabase SQL Editor aplica, en orden, las migraciones `202608120001_initial.sql`, `202608120002_harden_public_report_submission.sql` y `202608120003_fix_report_urgency_and_diagnostics.sql`.
4. Configura todas las variables de `.env.example` en el panel de Render; nunca las subas a Git.
5. Para producción establece:

```text
APP_URL=https://tu-dominio.example
ENABLE_TEST_DATA=false
CAPTCHA_PROVIDER=turnstile
NEXT_PUBLIC_CAPTCHA_SITE_KEY=...
CAPTCHA_SECRET_KEY=...
IP_HASH_SECRET=<secreto largo y aleatorio>
```

6. Configura `OPENAI_API_KEY` y `OPENAI_MODEL` solo si se habilitará la ayuda conversacional.
7. Despliega y comprueba `/api/health`, búsqueda normal, el formulario de reporte y el CAPTCHA desde un teléfono real.

No cargues los 15 datos ficticios en el proyecto de producción. Realiza esa comprobación en un proyecto Supabase separado de demo.
