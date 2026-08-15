# Rutas de Encontrarnos

## Públicas

| Ruta | Uso |
| --- | --- |
| `/` | Inicio, búsqueda, acceso a desaparecidos y fallecidos confirmados. |
| `/buscar` | Catálogo paginado de casos publicados; filtros visibles: `Todos`, `Desaparecidos` y `Fallecidos confirmados` (`pagina` conserva el filtro). |
| `/buscar/ia` | Ayuda conversacional opcional; las cards siguen proviniendo de la búsqueda pública. |
| `/fallecidos` | Buscador y listado paginado, desde Supabase, exclusivamente de casos `published` + `deceased_confirmed` + `authority_confirmed`. Las cards muestran la fuente pública segura y `Unidad básica / lugar reportado`, sin afirmar que sea el lugar de muerte. |
| `/reportar-desaparecido` | Formulario público simplificado para reportar una persona. |
| `/reportar` | Alias que redirige a `/reportar-desaparecido`. |
| `/persona/[slug]` | Ficha pública y avistamientos aprobados. |
| `/persona/[slug]/informacion` | Envío privado de avistamientos, correcciones u otra información. |
| `/reporte/confirmacion` | Confirmación pública genérica del envío. No recibe ni muestra el tracking, ofrece solo volver al inicio o reportar otra persona y declara `noindex, nofollow`. No consulta el estado en base de datos. |
| `/reporte/confirmacion/[trackingCode]` | Compatibilidad heredada: valida el formato y redirige a `/reporte/confirmacion`, de modo que el código también desaparece de la barra de direcciones. |
| `/privacidad` | Resumen público de privacidad. |
| `/correccion` | Instrucciones para solicitar una corrección. |
| `/retiro` | Instrucciones para solicitar retiro mediante reporte privado. |

Las páginas públicas solo consultan el contrato permitido: `public_case_cards`, `search_public_people`, `get_public_case` y `submit_public_report`. No incluyen contactos, campos privados, rutas de Storage, autoridad privada, auditoría ni reportes pendientes.

## Administrativas

| Ruta | Roles | Uso |
| --- | --- | --- |
| `/admin/login` | Sin sesión | Inicio de sesión con Supabase Auth. |
| `/admin` | `admin`, `moderator`, `responder` | Panel adaptado a las capacidades del rol. |
| `/admin/personas-pendientes` | `admin`, `moderator` | Revisar nuevos casos, gestionar personas publicadas y consultar mensajes/seguimiento agrupados por caso. El retiro de una card publicada es exclusivo de `admin`. |
| `/admin/avistamientos` | Lectura: todos; acciones: `admin`, `moderator` | Cola de reportes pendientes/escalados y moderación de avistamientos. |
| `/admin/posibles-avistamientos` | Igual que `/admin/avistamientos` | Alias que redirige a la cola canónica. |
| `/admin/seguimiento-contactos` | Lectura: todos; escritura: `admin`, `moderator` | Contactos privados y seguimientos append-only. |
| `/admin/importar-fallecidos` | `admin` | Vista previa y confirmación de importación oficial. |
| `/admin/importar-fallecidos/ayuda` | `admin` | Preparación y revisión de CSV/Excel. |
| `/admin/importar-personas` | `admin` | Importador unificado CSV/Excel/tabla pegada para desaparecidos y fallecidos. |

`responder` ve las colas y el historial autorizados, pero la UI oculta formularios de moderación y escritura. Los RPCs vuelven a aplicar esa restricción en PostgreSQL.

## APIs y diagnóstico

| Ruta | Método | Uso |
| --- | --- | --- |
| `/api/health` | `GET` | Estado sin secretos: configuración, alcance a la base, `schemaVersion`, disponibilidad del filtro de fallecidos y validez de `APP_URL`. |
| `/api/search` | `GET` | Búsqueda exclusiva de casos publicados. |
| `/api/ai-search` | `POST` | Interpretación opcional y búsqueda pública. |
| `/api/reports` | `POST` | Nuevos casos e información privada. |
| `/api/debug/reports` | `GET` | Diagnóstico temporal protegido por `x-debug-token`: esquema/RLS/RPCs/buckets, última migración, conteos públicos agregados y preparación del filtro de fallecidos. |
| `/api/admin/pending-people` | `GET`, `POST` | Cola y revisión de personas pendientes. |
| `/api/admin/people` | `GET`, `POST` | Listado administrativo y retiro lógico auditado de cards publicadas. |
| `/api/admin/case-messages` | `GET` | Bandeja privada de mensajes web e historial de seguimiento agrupado por caso. |
| `/api/admin/sightings` | `GET`, `POST` | Cola y moderación de reportes. |
| `/api/admin/contact-followups` | `GET`, `POST` | Cola y altas append-only de seguimiento. |
| `/api/admin/private-media/[assetId]` | `GET` | Acceso autenticado y auditado a evidencia privada. |
| `/api/admin/import-deceased` | `POST` | Modos `preview` y `confirm` del importador oficial. |
| `/api/admin/import-people` | `POST` | Importador multipart unificado; preview firmado y confirmación auditada. |
| `/api/admin/cases/[caseId]/portrait` | `POST`, `DELETE` | Subir/reemplazar o quitar retrato público; solo `moderator`/`admin`. |

Las respuestas administrativas con datos sensibles usan `Cache-Control: private, no-store`. Los conteos del diagnóstico son agregados y solo consideran registros públicos válidos; nunca devuelve nombres, referencias privadas, contactos ni filas del importador.

Consulta el mapa completo en [PROJECT_CONTEXT_COMPLETE.md](PROJECT_CONTEXT_COMPLETE.md#rutas-y-roles).
