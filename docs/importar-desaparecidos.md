# Importar personas desaparecidas

El área `/admin/importar-personas` es exclusiva de administradores. Acepta `.csv`, `.xlsx` y tablas CSV/TSV pegadas, hasta 500 filas y 5 MB. Preparar un archivo no autoriza importarlo en producción.

## Columnas

```text
source_row,full_name,department_disappearance,municipality_disappearance,source_name,source_reference,public_description
```

También reconoce los encabezados `N°`, `Nombres`, `Departamento Desaparición` y `Municipio Desaparición`. `full_name`, `source_name` y `source_reference` son obligatorios. Departamento, municipio, fila de origen y descripción pública pueden quedar vacíos. Las iniciales se conservan tal cual; no se crean alias, edad, sexo, condición de menor ni foto.

La UI pública compone el lugar así:

- municipio + departamento: `Lugar reportado: Municipio, Departamento`;
- solo departamento o municipio: muestra únicamente el valor existente;
- ambos vacíos: `Lugar reportado: No especificado`.

## Verificación y publicación

- `Revisado por moderación`: crea `missing` + `moderator_reviewed` + `pending_review`. No aparece en el buscador hasta el flujo normal de revisión.
- `Fuente oficial`: exige fuente, referencia, checkbox y razón; crea `missing` + `authority_confirmed` + `published`.

La referencia queda únicamente en columnas privadas/ledger y nunca en `public_case_cards`.

## Vista previa e idempotencia

La API firma la vista previa con el administrador, contenido normalizado, tipo, nivel de verificación y vencimiento de 15 minutos. Antes de confirmar repite el preview dentro del flujo. `person_import_entries` usa tipo + fuente + referencia + nombre normalizado y una huella del payload:

- replay exacto: `already_imported`, sin duplicar caso ni auditoría;
- mismo origen con contenido cambiado: revisión manual;
- nombre normalizado repetido dentro del archivo o ya existente: revisión manual por posible homónimo.

## CLI controlado

El comando siempre crea registros pendientes y exige las dos variables de confirmación:

```bash
CONFIRM_MISSING_IMPORT=DESAPARECIDOS \
MISSING_IMPORT_REASON="Lista revisada por el equipo autorizado" \
npm run import:missing -- data/imports/desaparecidos-lista-admin-2026-08-15.csv
```

También requiere `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y un `SUPABASE_ADMIN_ACCESS_TOKEN` temporal de un administrador activo. No se debe guardar ese token en Render ni en Git.

La lista mencionada en el requerimiento no se importa automáticamente. Solo debe crearse a partir de las filas realmente entregadas; nunca se completan filas faltantes ni datos ausentes.
