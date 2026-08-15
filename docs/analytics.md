# Cloudflare Web Analytics

Encontrarnos usa analítica opcional y mínima. No se instala Google Analytics y no existen eventos personalizados.

## Configuración

1. En Cloudflare Dashboard abre **Analytics & Logs → Web Analytics**.
2. Agrega el hostname de producción y copia el token del snippet manual. Consulta la [guía oficial de activación](https://developers.cloudflare.com/web-analytics/get-started/).
3. En Render, abre el Web Service → **Environment** y agrega:

   ```text
   NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN=<token del sitio>
   ```

4. Ejecuta un Manual Deploy, porque las variables `NEXT_PUBLIC_*` se incorporan durante el build.
5. Visita `/` o `/privacidad` sin parámetros y verifica la solicitud a `https://static.cloudflareinsights.com/beacon.min.js` y luego las visitas en Web Analytics. Cloudflare advierte que las métricas pueden tardar unos minutos en aparecer.

Si el token falta o tiene formato inválido, no se renderiza el componente y el build continúa.

## Controles de privacidad

El componente se monta desde `src/app/layout.tsx`, pero solo habilita el script en `/`, `/fallecidos` sin parámetros y `/privacidad`. Usa `afterInteractive`, `type="module"` y `spa:false`, tal como permite la [documentación SPA oficial](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/).

Nunca se mide:

- `/buscar` ni su query `q`;
- `/persona/[slug]`;
- formularios o confirmaciones con tracking;
- `/admin` o APIs;
- nombres, teléfonos, correos, referencias internas o rutas privadas;
- eventos personalizados.

Cloudflare indica actualmente que Web Analytics no registra query strings y no ofrece custom events; además afirma que no usa cookies/localStorage para estas métricas. Véanse las [FAQ oficiales](https://developers.cloudflare.com/web-analytics/faq/) y [datos recolectados](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/). La aplicación conserva sus exclusiones aunque ese comportamiento externo cambie.

La CSP permite únicamente el script `static.cloudflareinsights.com` y el endpoint manual `cloudflareinsights.com`. Cualquier ampliación de rutas o telemetría requiere una nueva revisión de privacidad.
