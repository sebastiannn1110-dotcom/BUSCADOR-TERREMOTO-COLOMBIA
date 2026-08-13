# Importar fallecidos confirmados de Medicina Legal

La URL es `/admin/importar-fallecidos`. Exige Supabase Auth, perfil activo y rol `admin`. El MVP no acepta como fuente oficial una red social, una captura reenviada, una transcripción sin verificar ni una entidad diferente de Medicina Legal.

## Preparar el CSV

Descarga `data/templates/medicina-legal-fallecidos-template.csv` o su copia pública en `/templates/medicina-legal-fallecidos-template.csv`. Las columnas y su orden deben ser exactamente:

```text
full_name,approximate_age,source_name,source_reference,public_description,last_seen_location_public,date_confirmed
```

- `full_name`, `source_name` y `source_reference` son obligatorios.
- `source_name` debe ser `Medicina Legal`, sin distinguir mayúsculas.
- `source_reference` debe identificar el comunicado, URL o documento oficial revisado; se almacena como referencia privada de autoridad.
- `approximate_age`, si existe, debe estar entre 0 y 120.
- `date_confirmed`, si existe, usa `AAAA-MM-DD`.
- descripción y lugar públicos son opcionales, aproximados y no pueden contener teléfonos o correos.
- El CSV no incluye columna de género ni fotos.
- Máximo: 500 filas y 512 KB.

No incluyas documentos de identidad, direcciones exactas, contactos, nombres de reportantes, datos clínicos, rutas de archivos ni notas internas. La referencia y la justificación administrativa nunca se proyectan al HTML público.

## Vista previa

El modo `preview` valida el archivo completo, consulta `preview_official_deceased_import` y muestra por fila:

- `Crear`: no hay coincidencia exacta normalizada.
- `Actualizar`: existe una coincidencia no ambigua.
- `Ya importado`: la misma referencia oficial ya corresponde a esa persona; un reintento se omitirá.
- `Revisión manual`: existe una ambigüedad y la confirmación se bloquea.

La API entrega un token breve ligado al usuario y al contenido del CSV. Si el archivo cambia o la vista previa vence, hay que generar otra.

## Confirmación e idempotencia

Para confirmar, el administrador debe:

1. mantener exactamente el CSV previsualizado;
2. marcar que lo revisó contra la fuente oficial;
3. escribir una justificación de 10 a 1000 caracteres;
4. no tener filas con `Revisión manual`.

El servidor repite la vista previa y el RPC vuelve a validar rol, fuente, referencia, límites y coincidencias dentro de la transacción. Una fila válida deja el caso `published`, `deceased_confirmed`, `authority_confirmed`, con etiqueta pública `Medicina Legal`, referencia/razón privadas e historial y auditoría.

La migración vigente protege reintentos: una misma referencia para la misma persona ya importada se omite sin crear nueva auditoría; reutilizar esa referencia para otra persona se bloquea; duplicados de nombre normalizado o referencia dentro del mismo archivo requieren revisión o se rechazan. Si `date_confirmed` está vacío, no se inventa una fecha oficial.

## Rectificaciones

No borres personas, historial ni auditoría. Si Medicina Legal rectifica una publicación, usa un flujo administrativo expresamente auditado que cite la rectificación, preserve la referencia anterior y oculte o corrija el caso según la política institucional. Si hay una coincidencia ambigua, detén la importación y resuelve la identidad antes de intentar de nuevo.

La vista previa y la confirmación son dos pasos técnicos de la misma sesión; no equivalen por sí solas a una aprobación independiente de cuatro ojos. Si la operación lo exige, añade una segunda revisión humana al procedimiento organizacional.
