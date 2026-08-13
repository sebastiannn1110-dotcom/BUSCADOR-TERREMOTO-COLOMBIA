# Base de datos

El esquema separa identidad, caso, reportes y contacto para que la proyección pública no dependa de seleccionar columnas privadas desde una tabla completa.

## Tablas principales

| Relación | Contenido | Pública |
| --- | --- | --- |
| `people` | Nombre, alias, edad, minoría y atributos privados/públicos de identidad. | Solo mediante proyección. |
| `cases` | Estado, verificación, publicación, ubicaciones, resolución y autoridad privada. | Solo mediante proyección. |
| `case_reports` | Reportes nuevos, avistamientos e información; empiezan en `pending`. | Solo sightings aprobados y redactados. |
| `reporter_contacts` | Nombre, relación, teléfono, correo y consentimiento. | Nunca. |
| `media_assets` | Metadatos y rutas de evidencia/retratos. | Solo URL de retrato aprobada a través de la vista. |
| `contact_followups` | Historial privado de gestiones con contactos. | Nunca. |
| `official_deceased_import_entries` | Bitácora privada de idempotencia por referencia y fila de la fuente oficial. | Nunca. |
| `moderation_actions` | Acciones y razones administrativas. | Nunca. |
| `status_history` | Transiciones de condición/verificación. | Nunca. |
| `audit_logs` | Accesos y operaciones sensibles. | Nunca. |
| `submission_rate_limits` | Huellas y ventanas antiabuso. | Nunca. |

`contact_followups` valida que caso, reporte y contacto pertenezcan al mismo flujo. Es append-only: usuarios autenticados no reciben `INSERT`, `UPDATE` ni `DELETE` directos; `log_contact_followup` es la única escritura y crea la auditoría correspondiente.

## Proyección pública

`public_case_cards` expone casos `published`, no eliminados y no marcados como prueba. Incluye campos públicos mínimos, retrato aprobado, etiqueta de fuente, `reported_unit` y sightings aprobados con ubicación y descripción públicas. Proyecta `distinguishing_features` y `clothing` como `null` para evitar una fuga de los valores privados originales. Nunca proyecta la referencia oficial ni su número de fila.

El acceso REST directo a la vista está revocado. Los consumidores usan:

- `search_public_people`;
- `get_public_case`;
- `submit_public_report`, solo desde el servidor con service role.

## RLS, permisos y estados

Las tablas sensibles tienen RLS. La migración `202608130001` revoca DML directo a `anon` y `authenticated`; las mutaciones pasan por RPCs con validación de rol. `profiles` solo permite lectura autenticada y `contact_followups` solo lectura staff por RLS.

Los checks impiden `deceased_confirmed` sin `authority_confirmed`, razón y referencia privada. Ningún RPC público cambia condición o publicación. Aprobar un avistamiento tampoco cambia el estado de un caso.

## Storage

- `report-evidence`: privado; evidencia original, máximo 8 MB, JPG/PNG/WebP.
- `public-portraits`: público; retratos aprobados por servidor. Las referencias válidas usan `portraits/{caseId}/{uuid}.jpg` y corresponden a un objeto existente.

## Migraciones

La versión esperada es `202608130003` y requiere siete archivos, en orden. La migración más reciente añade el retiro lógico auditado de cards publicadas, el listado administrativo y los hilos privados de mensajes por caso. El código no prueba que estén aplicados en producción; valida `supabase_migrations.schema_migrations`, RLS, grants, RPCs, conteos agregados y buckets antes de desplegar.
