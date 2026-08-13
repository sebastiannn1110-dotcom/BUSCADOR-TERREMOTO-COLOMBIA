# Rutas de Encontrarnos

## Públicas

| Ruta | Uso |
| --- | --- |
| `/` | Inicio, búsqueda y accesos principales. |
| `/buscar` | Catálogo y búsqueda de casos publicados. |
| `/reportar-desaparecido` | Formulario público de tres pasos para reportar una persona. |
| `/reportar` | Alias permanente que redirige a `/reportar-desaparecido`. |
| `/persona/[slug]` | Ficha pública y avistamientos aprobados del caso. |
| `/persona/[slug]/informacion` | Envío privado de avistamientos, correcciones u otra información. |
| `/reporte/confirmacion/[trackingCode]` | Confirmación, código, URL copiable y estado pendiente de revisión. |

Las páginas públicas solo consultan los RPC/vistas públicas autorizadas. No incluyen contactos, ubicaciones privadas, rutas de Storage, referencias de autoridad ni reportes pendientes.

## Administrativas

| Ruta | Rol |
| --- | --- |
| `/admin/login` | Inicio de sesión con Supabase Auth. |
| `/admin` | Moderador o administrador activo. |
| `/admin/avistamientos` | Moderador o administrador; cola y acciones auditadas. |
| `/admin/importar-fallecidos` | Solo administrador; vista previa e importación oficial. |

Las APIs protegidas correspondientes son `GET/POST /api/admin/sightings` y `POST /api/admin/import-deceased`.
