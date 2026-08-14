# Video público de Encontrarnos

El recorrido se graba con Chromium real mediante Playwright, en una ventana móvil de 390 × 844 píxeles. No visita administración, no abre herramientas de desarrollo y no envía reportes.

## Generar el video

```powershell
npm run video:tour:35
```

Por defecto usa `https://buscador-terremoto-colombia.onrender.com`. Para revisar cambios locales sin desplegar:

```powershell
$env:VIDEO_TOUR_URL = "http://127.0.0.1:3334"
npm run video:tour:35
```

Archivos generados:

- `encontrarnos-tour-35s.webm`: video principal, obligatorio.
- `encontrarnos-tour-35s.mp4`: copia H.264 creada únicamente cuando `ffmpeg` está disponible.
- `encontrarnos-tour-35s-screenshots/`: capturas de los momentos principales.
- `encontrarnos-tour-35s-voiceover.txt`: locución completa solicitada y versión breve apta para 35 segundos.

El script valida que el WebM dure entre 30 y 35 segundos, que `/fallecidos` muestre dos cards por fila a 390 píxeles y que no haya solicitudes a rutas administrativas ni envíos a `/api/reports`.
