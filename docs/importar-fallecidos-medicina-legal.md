# Importar fallecidos confirmados de Medicina Legal

Este procedimiento maneja información oficial sensible. Preparar el archivo no autoriza su carga: aplicar la migración, desplegar el código y ejecutar la importación en producción son acciones independientes. El CSV controlado queda listo, pero no debe importarse sin autorización operativa expresa.

## Prerrequisitos

- Las ocho migraciones deben estar aplicadas. Antes del push/deploy, el gate disponible es `npm run inspect:production` o una consulta administrativa directa a `reports_debug_snapshot`: debe confirmar `schemaVersion: "202608130004"`, `lastMigrationApplied: "202608130004"` y `deceasedFilterReady: true`. El `/api/health` nuevo se valida después del Manual Deploy.
- La persona operadora debe tener un perfil Supabase Auth activo con rol `admin`.
- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` deben apuntar al proyecto de destino.
- La sesión debe suministrar un `SUPABASE_ADMIN_ACCESS_TOKEN` vigente obtenido mediante una sesión normal de Supabase Auth de ese administrador. No uses `SUPABASE_SERVICE_ROLE_KEY` como sustituto; consulta [moderation-workflow.md](moderation-workflow.md#gestión-posterior-de-staff) para el mismo contrato operativo de token efímero.
- Debe existir una razón administrativa verificable de 10–1000 caracteres.

## Dos formatos separados

### Importador web legado

La URL `/admin/importar-fallecidos` exige Supabase Auth y rol `admin`. Conserva el CSV legado de siete columnas, disponible como plantilla en `data/templates/medicina-legal-fallecidos-template.csv` y `/templates/medicina-legal-fallecidos-template.csv`:

```text
full_name,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

Este flujo acepta hasta 500 filas/512 KB, genera una vista previa ligada al usuario y al archivo, y exige confirmar la fuente y una justificación antes de importar. No añadas `source_row`, `reported_unit` ni `gender` a esta plantilla: el importador web mantiene compatibilidad con el contrato anterior.

### CLI de la captura del 13 de agosto

El archivo versionado y revisable es:

```text
data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv
```

Contiene exactamente 142 registros, correspondientes a las filas de fuente 1–142, con esta cabecera de diez columnas:

```text
source_row,reported_unit,full_name,gender,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

Para este archivo:

- `source_name` es exactamente `Medicina Legal`.
- `source_reference` es exactamente `Lista Medicina Legal aportada por administrador - captura 2026-08-13`. El valor forma parte del CSV versionado, pero no se proyecta en la aplicación o API pública ni se usa como etiqueta pública.
- `public_description` es `Información tomada de las listas de Medicina Legal.`.
- `last_seen_location_public` copia `reported_unit`.
- `date_confirmed` queda vacío porque la captura no aporta una fecha individual de confirmación.
- `gender` preserva la transcripción, pero el CLI lo omite del payload enviado a los RPC y no se proyecta públicamente.
- No se suministra foto y no se crea una imagen ficticia; `primary_public_photo_path` queda nulo para los casos nuevos.

`reported_unit` representa la columna **Unidad Básica** de la fuente. En público se etiqueta **Unidad básica / lugar reportado**. No debe describirse como lugar de muerte.

## Validaciones y privacidad

El CLI rechaza una cabecera distinta, UTF-8 inválido, más de 500 filas/512 KB, nombres o referencias vacíos, edades fuera de 0–120, fechas inválidas, unidades vacías, contacto aparente en campos públicos, otra fuente y filas de origen repetidas. También exige que `last_seen_location_public` coincida con `reported_unit`.

El RPC establece únicamente tras una importación autorizada:

- `publication_status = published`;
- `condition_status = deceased_confirmed`;
- `verification_level = authority_confirmed`;
- `urgency_level = normal`;
- `public_source_label = Medicina Legal`;
- `authority_reference_private = source_reference`;
- `primary_public_photo_path = null` para los casos creados sin foto;
- historial de estado, acción de moderación y auditoría.

De los campos de procedencia, la API pública solo proyecta `public_source_label` y el texto seguro `reported_unit`. Nunca proyecta `source_reference`, `authority_reference_private`, razón, `source_row`, género de la captura, operador ni metadatos de auditoría.

## Preview e idempotencia

El comando llama primero a `preview_official_deceased_import`. Para este flujo conservador, cada fila queda clasificada como `create`, `already_imported` o `review_required`. Una coincidencia solo por nombre nunca actualiza ni declara fallecido un caso existente: exige resolución manual fuera de este importador. Si al menos una fila requiere revisión, el proceso termina antes de llamar a `import_official_deceased`.

La migración `202608130002_official_deceased_capture_and_diagnostics.sql` añade la bitácora privada `official_deceased_import_entries`. La identidad idempotente de esta captura es la combinación `source_reference + source_row`:

- repetir exactamente una fila ya importada produce `already_imported`; la bitácora compara además una huella canónica del contenido autorizado;
- la misma referencia puede identificar las 142 filas porque cada una conserva su `source_row`;
- reutilizar la misma combinación para otra persona se bloquea para revisión;
- cambiar edad, unidad, descripción, ubicación o fecha bajo la misma combinación también se bloquea para revisión;
- no cambies `source_row` para eludir un conflicto.

La referencia común se conserva exactamente; no se le añaden sufijos inventados. El formato legado sin `source_row` sigue las reglas conservadoras anteriores del importador web.

## Ejecución autorizada

Define en una sesión operativa efímera, nunca en Git ni como variables persistentes de Render:

```text
CONFIRM_OFFICIAL_IMPORT=MEDICINA_LEGAL
SUPABASE_ADMIN_ACCESS_TOKEN=<JWT vigente del admin>
OFFICIAL_IMPORT_REASON=<razón aprobada de 10–1000 caracteres>
NEXT_PUBLIC_SUPABASE_URL=<proyecto Supabase correcto>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave publicable del proyecto>
```

Después ejecuta desde la raíz del repositorio y el commit aprobado:

```bash
npm run import:official-deceased -- data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv
```

El programa imprime dos líneas JSON agregadas: primero el resumen de preview y después un resumen final con `status`, `total`, `created`, `updated`, `alreadyImported`, `duplicatesBlocked` y `errors`. Si hay filas para revisión, el segundo resumen usa `status: "blocked"`, contabiliza `duplicatesBlocked`, no llama al RPC de importación y termina con código 2. Un error previo o de RPC devuelve `status: "error"`, `errors: 1`, contadores conservadores en cero y un mensaje sanitizado. No registra nombres, filas completas, token ni referencia privada. En este flujo seguro `updated` permanece en cero: cualquier coincidencia por nombre se bloquea. Para este archivo, `total` debe ser 142 y la suma de creados y ya importados debe cubrir las 142 filas sin errores.

Al terminar, elimina de la sesión `SUPABASE_ADMIN_ACCESS_TOKEN`, `OFFICIAL_IMPORT_REASON` y `CONFIRM_OFFICIAL_IMPORT`. Conserva el resumen agregado y la aprobación en el registro operativo correspondiente.

## Verificación en producción

Registro operativo del 13 de agosto de 2026: el preview autorizado clasificó las 142 filas como `create`, sin revisiones; la importación creó 142 casos, sin actualizaciones, duplicados ni errores. Un replay inmediato confirmó idempotencia con `created = 0` y `alreadyImported = 142`. El snapshot posterior informó `deceasedConfirmed = 142`, `schemaVersion = 202608130002` y `deceasedFilterReady = true`.

1. Después del Manual Deploy, abre `https://buscador-terremoto-colombia.onrender.com/api/health` y confirma:

   ```json
   {
     "databaseReachable": true,
     "schemaVersion": "202608130004",
     "deceasedRouteAvailable": true,
     "appUrlConfiguredCorrectly": true
   }
   ```

2. Con `DEBUG_REPORTS_TOKEN` temporal, consulta `GET /api/debug/reports` enviando `x-debug-token`. Confirma la última migración, `deceasedFilterReady: true`, RLS forzado en `official_deceased_import_entries`, ambos buckets y el conteo agregado `publishedCounts.deceasedConfirmed`. Elimina el token de Render al finalizar.
3. Abre `https://buscador-terremoto-colombia.onrender.com/fallecidos`. Verifica respuesta 200, búsqueda, paginación y únicamente cards con confirmación de autoridad.
4. Verifica en una card importada: placeholder `Foto no disponible`, nombre/edad, `Unidad básica / lugar reportado`, `Declarado muerto por Medicina Legal`, `Información tomada de las listas de Medicina Legal`, `Ver caso` y el enlace de corrección.
5. Abre `https://buscador-terremoto-colombia.onrender.com/buscar?estado=deceased_confirmed` y confirma que devuelve el mismo contrato público. La UI no debe ofrecer filtros de localizados o reunidos.
6. Contrasta el conteo agregado de `/api/debug/reports` con una consulta administrativa en Supabase que filtre `published`, `deceased_confirmed`, `authority_confirmed`, no eliminados y no demo. La ruta pública usa `search_public_people`/`public_case_cards`; no existe un fixture ni una lista hardcodeada en el runtime.

## Rectificaciones

No borres personas, historial ni auditoría. Si Medicina Legal rectifica una publicación, usa un flujo administrativo expresamente auditado que cite la rectificación, preserve la referencia anterior y oculte o corrija el caso según la política institucional. Una vista previa y una confirmación técnica no sustituyen una segunda revisión humana cuando la política institucional exige cuatro ojos.
