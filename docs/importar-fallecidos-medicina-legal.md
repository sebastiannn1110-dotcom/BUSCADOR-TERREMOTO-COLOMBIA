# Importar fallecidos confirmados de Medicina Legal

La URL es `/admin/importar-fallecidos` y exige una sesión de Supabase Auth cuyo perfil esté activo y tenga rol `admin`.

## Preparar el archivo

Descarga `data/templates/medicina-legal-fallecidos-template.csv`. Las columnas, en orden exacto, son:

```text
full_name,approximate_age,gender,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

- `full_name` y `source_name` son obligatorios.
- `source_name` debe ser exactamente `Medicina Legal` sin distinguir mayúsculas.
- `source_reference` debe identificar el comunicado, URL o documento oficial revisado; queda en el campo privado de autoridad.
- `date_confirmed` usa `AAAA-MM-DD`.
- Las demás columnas son opcionales. No agregues foto: una persona sin foto mostrará el placeholder público.
- Máximo: 500 filas y 512 KB.

“Fuente oficial” significa una publicación verificable emitida directamente por el Instituto Nacional de Medicina Legal y Ciencias Forenses, no una captura reenviada, una red social o una transcripción sin revisión.

No incluyas teléfonos, correos, documentos de identidad, direcciones exactas, nombres de reportantes, datos clínicos, rutas de archivos ni notas internas. La referencia de autoridad y la justificación administrativa nunca se proyectan al HTML público.

## Vista previa y duplicados

La vista previa normaliza el nombre de cada fila y muestra cuántas personas coinciden exactamente:

- `Crear`: no existe coincidencia.
- `Actualizar`: existe una coincidencia exacta.
- `Revisión manual`: hay más de una; la confirmación se bloquea.

Al confirmar, el RPC vuelve a comprobar rol, filas y duplicados dentro de la transacción. Cada caso queda `deceased_confirmed`, `authority_confirmed`, `published` y con urgencia `normal`. Se registra `status_history`, `audit_logs` y `moderation_actions`. Una foto pública preexistente se conserva; para un caso nuevo la ruta queda nula.

## Archivar o corregir una importación

No borres personas, historial ni auditoría. Si la autoridad rectifica una publicación, un administrador debe ocultar o archivar el caso mediante el flujo administrativo de estado, registrar una razón que cite la rectificación y conservar la referencia anterior en el historial. Si el nombre coincidió con más de un registro, detén la importación y resuelve la identidad manualmente antes de volver a generar la vista previa.
