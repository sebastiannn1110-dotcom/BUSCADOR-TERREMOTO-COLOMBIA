# Despliegue en Render

Configure un Web Service Node con build command `npm ci && npm run build` y start command `npm run start`. Añada las variables de `.env.example` en el panel de Render; no suba secretos al repositorio. Ejecute las migraciones en Supabase antes del despliegue y mantenga `ENABLE_TEST_DATA=false` en producción. Configure `APP_URL` con la URL HTTPS final.
