# Privacidad y seguridad

Encontrarnos es privada por defecto. La plataforma facilita búsqueda y mediación humana, pero no sustituye a las autoridades, los servicios de emergencia ni los procesos oficiales de identificación.

## Contrato público

Las páginas públicas obtienen casos únicamente mediante `public_case_cards`, `search_public_people`, `get_public_case` y el envío limitado `submit_public_report`. La aplicación aplica además una allowlist defensiva antes de renderizar una card.

Se pueden publicar, tras revisión:

- nombre y edad aproximada;
- estado y nivel de verificación;
- fecha y ubicación aproximada;
- descripción redactada para público;
- retrato expresamente aprobado;
- avistamientos aprobados con ubicación y descripción públicas;
- etiqueta de fuente pública, por ejemplo `Medicina Legal`.
- unidad básica o lugar reportado por la fuente, sin presentarlo como lugar de muerte.

Nunca se publican:

- teléfonos, correos, documentos o datos de reportantes;
- direcciones o coordenadas exactas;
- circunstancias, rasgos, ropa o notas privadas sin una redacción pública nueva;
- evidencia original, nombres de archivo o rutas de Storage;
- referencias privadas de autoridad, razones de moderación o auditoría;
- reportes pendientes, rechazados, escalados o marcados como sensibles.

Los campos públicos rechazan patrones obvios de teléfono y correo tanto en la aplicación como en los RPC críticos. La UI no copia automáticamente ubicación o descripción privadas a los campos de publicación.

## Contacto mediado

No existe contacto público directo entre familiares e informantes. El equipo autorizado actúa como intermediario desde `/admin/seguimiento-contactos`. Cada gestión guarda un resumen privado, método, estado y próxima fecha opcional en `contact_followups`; el historial es append-only y cada alta se audita. La plataforma no envía WhatsApp, SMS ni correo automáticamente.

## Evidencia y retratos

- `report-evidence` es privado y contiene fotos o evidencia recibida.
- `public-portraits` es público y solo debe contener retratos aprobados.
- El acceso administrativo a evidencia pasa por una ruta protegida y un RPC que registra auditoría.
- Al aprobar una foto, el servidor valida formato y tamaño, corrige orientación, limita a 1600 × 1600, la recodifica como JPEG y no conserva metadatos EXIF. Solo entonces la sube a una ruta `portraits/{caseId}/{uuid}.jpg`.
- Si falla la revisión después de subir el retrato, la API intenta eliminar el objeto promovido.

La separación de buckets evita que una ruta privada se convierta accidentalmente en URL pública.

## Roles

| Rol | Acceso |
| --- | --- |
| `admin` | Revisión, moderación, seguimiento e importación oficial. |
| `moderator` | Revisión de personas, moderación de reportes y registro de seguimientos. |
| `responder` | Lectura operativa de colas, contactos y evidencia autorizada; no modera ni escribe seguimientos. |

Las páginas y APIs verifican sesión, perfil activo y rol. Las tablas sensibles no permiten DML directo a `anon` o `authenticated`; las escrituras pasan por RPCs `security definer` con validación de rol y auditoría.

## Estados de alto impacto

Ninguna acción pública actualiza un estado. Aprobar un avistamiento tampoco cambia la condición del caso. `deceased_confirmed` solo puede establecerse mediante un flujo administrativo con:

- rol `admin`;
- `authority_confirmed`;
- fuente oficial aceptada en el MVP (`Medicina Legal`);
- `source_reference` y razón privadas obligatorias;
- historial, acción de moderación y auditoría.

La página `/fallecidos` filtra además por `deceased_confirmed` y `authority_confirmed`. Una afirmación comunitaria de posible fallecimiento permanece privada y pendiente.

## Controles de ingreso y abuso

Los reportes validan esquema, tamaño, tipos de archivo, honeypot, consentimiento y límite de envíos. Turnstile se activa únicamente cuando `CAPTCHA_PROVIDER`, la clave pública y la clave secreta están configuradas. `IP_HASH_SECRET` debe ser largo, aleatorio y diferente de cualquier credencial de Supabase.

Los reportes de posible atrapamiento o posible fallecimiento exigen contacto y se mantienen sensibles. Las pruebas usan exclusivamente datos ficticios y solo se siembran con `ENABLE_TEST_DATA=true` fuera de producción.

## Responsabilidades operativas pendientes

Antes de usar datos reales, la organización debe definir retención y borrado, respuesta a incidentes, derechos del titular, revisión legal, MFA para personal, rotación de credenciales, monitoreo y respaldo. También debe comprobar en el proyecto Supabase de producción que las seis migraciones, RLS, grants, RPCs, conteos agregados y buckets coincidan con el repositorio.
