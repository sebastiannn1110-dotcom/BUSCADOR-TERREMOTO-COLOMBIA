# Rutas de Encontrarnos

## Públicas

| Ruta | Uso |
| --- | --- |
| `/` | Inicio, búsqueda, acceso a desaparecidos y fallecidos confirmados. |
| `/buscar` | Catálogo paginado y filtros de casos publicados (`pagina` conserva el filtro). |
| `/buscar/ia` | Ayuda conversacional opcional; las cards siguen proviniendo de la búsqueda pública. |
| `/fallecidos` | Listado paginado de casos publicados con `deceased_confirmed` y `authority_confirmed`. |
| `/reportar-desaparecido` | Formulario público simplificado para reportar una persona. |
| `/reportar` | Alias que redirige a `/reportar-desaparecido`. |
| `/persona/[slug]` | Ficha pública y avistamientos aprobados. |
| `/persona/[slug]/informacion` | Envío privado de avistamientos, correcciones u otra información. |
| `/reporte/confirmacion/[trackingCode]` | Recibo con código y URL copiable. No consulta el estado en base de datos. |
| `/privacidad` | Resumen público de privacidad. |
| `/correccion` | Instrucciones para solicitar una corrección. |
| `/retiro` | Instrucciones para solicitar retiro mediante reporte privado. |

Las páginas públicas solo consultan el contrato permitido: `public_case_cards`, `search_public_people`, `get_public_case` y `submit_public_report`. No incluyen contactos, campos privados, rutas de Storage, autoridad privada, auditoría ni reportes pendientes.

## Administrativas

| Ruta | Roles | Uso |
| --- | --- | --- |
| `/admin/login` | Sin sesión | Inicio de sesión con Supabase Auth. |
| `/admin` | `admin`, `moderator`, `responder` | Panel adaptado a las capacidades del rol. |
| `/admin/personas-pendientes` | `admin`, `moderator` | Revisar, publicar, rechazar, deduplicar, archivar o pedir información sobre nuevos casos. |
| `/admin/avistamientos` | Lectura: todos; acciones: `admin`, `moderator` | Cola de reportes pendientes/escalados y moderación de avistamientos. |
| `/admin/posibles-avistamientos` | Igual que `/admin/avistamientos` | Alias que redirige a la cola canónica. |
| `/admin/seguimiento-contactos` | Lectura: todos; escritura: `admin`, `moderator` | Contactos privados y seguimientos append-only. |
| `/admin/importar-fallecidos` | `admin` | Vista previa y confirmación de importación oficial. |
| `/admin/importar-fallecidos/ayuda` | `admin` | Preparación y revisión del CSV. |

`responder` ve las colas y el historial autorizados, pero la UI oculta formularios de moderación y escritura. Los RPCs vuelven a aplicar esa restricción en PostgreSQL.

## APIs y diagnóstico

| Ruta | Método | Uso |
| --- | --- | --- |
| `/api/health` | `GET` | Presencia de configuración básica; no sustituye la verificación de esquema. |
| `/api/search` | `GET` | Búsqueda exclusiva de casos publicados. |
| `/api/ai-search` | `POST` | Interpretación opcional y búsqueda pública. |
| `/api/reports` | `POST` | Nuevos casos e información privada. |
| `/api/debug/reports` | `GET` | Diagnóstico temporal protegido por `x-debug-token`. |
| `/api/admin/pending-people` | `GET`, `POST` | Cola y revisión de personas pendientes. |
| `/api/admin/sightings` | `GET`, `POST` | Cola y moderación de reportes. |
| `/api/admin/contact-followups` | `GET`, `POST` | Cola y altas append-only de seguimiento. |
| `/api/admin/private-media/[assetId]` | `GET` | Acceso autenticado y auditado a evidencia privada. |
| `/api/admin/import-deceased` | `POST` | Modos `preview` y `confirm` del importador oficial. |

Las respuestas administrativas con datos sensibles usan `Cache-Control: private, no-store`.

Consulta el mapa completo en [PROJECT_CONTEXT_COMPLETE.md](PROJECT_CONTEXT_COMPLETE.md#rutas-y-roles).
