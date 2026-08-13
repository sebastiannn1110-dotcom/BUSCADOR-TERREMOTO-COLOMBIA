# Moderación

## Roles

1. Crea el usuario en Supabase Auth.
2. Gestiona su fila de `profiles` exclusivamente mediante el RPC auditado correspondiente; nunca con SQL o `upsert` directo.
3. Asigna mínimo privilegio:

   - `admin`: todos los flujos, incluida importación oficial;
   - `moderator`: revisión, moderación y seguimiento;
   - `responder`: consulta operativa sin acciones de escritura.

Cada página, API y RPC vuelve a comprobar el rol. No se debe conceder acceso directo a las tablas para resolver un problema de UI.

La asignación o elevación de roles nunca usa `upsert` directo sobre `profiles`. Hay dos RPC con bloqueo transaccional y auditoría obligatoria:

- `bootstrap_initial_admin`: únicamente `service_role`, una sola vez y solo mientras no exista un administrador activo;
- `manage_staff_profile`: únicamente un administrador activo autenticado, para altas, cambios de rol y activación/desactivación posteriores.

### Primer administrador

1. Crea primero la cuenta en Supabase Auth y copia su UUID. No se crean contraseñas desde la base de datos.
2. En una terminal administrativa local carga `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` sin guardarlas en Git ni pasarlas como argumentos.
3. Ejecuta:

   ```bash
   npm run staff:bootstrap -- --user-id <uuid-auth> --display-name "Nombre interno" --reason "Motivo operativo de al menos diez caracteres" --confirm bootstrap-initial-admin
   ```

4. Verifica en `audit_logs` el evento `initial_admin_bootstrapped` y elimina la clave de servicio de la sesión local.

El RPC falla si el UUID no existe en `auth.users`, la razón es insuficiente, la llamada no tiene rol JWT `service_role` o el bootstrap ya ocurrió. La existencia de cualquier perfil `admin` o del evento histórico bloquea para siempre la reutilización, incluso si alguien alteró ese perfil fuera del flujo. Dos intentos concurrentes se serializan; solo uno puede crear el primer administrador.

### Gestión posterior de staff

Un administrador inicia sesión normalmente y obtiene un access token de corta duración. En una terminal local configura ese token como `SUPABASE_ADMIN_ACCESS_TOKEN`, junto con URL y clave publicable, y ejecuta:

```bash
npm run staff:manage -- --user-id <uuid-auth> --display-name "Nombre interno" --role moderator --active true --reason "Asignación aprobada para moderación" --confirm manage-staff-profile
```

El token no se configura en Render, no se escribe en `.env` y no se pasa por línea de comandos. La función exige un `admin` activo, valida que el usuario objetivo exista, aplica mínimo privilegio y registra `staff_profile_managed` con actor, estado anterior, estado nuevo y razón. Nunca permite desactivar o degradar al último administrador activo. Cada cambio debe contar además con la aprobación organizacional fuera del sistema (doble control).

## Persona nueva

1. Un reporte público crea persona, caso `pending_review`, reporte `pending`, contacto y evidencia privados.
2. `admin` o `moderator` abre `/admin/personas-pendientes`.
3. Revisa identidad, datos privados, contacto y evidencia.
4. Para publicar, redacta de cero la descripción y ubicación aproximada públicas. El sistema no copia automáticamente los valores privados y bloquea teléfonos/correos.
5. Opcionalmente elige una evidencia como retrato. El servidor la recodifica a JPEG sin EXIF antes de promoverla.
6. Registra una razón y elige `publish`, `reject`, `duplicate`, `request_information` o `archive`.
7. El RPC actualiza la publicación, guarda la acción y crea auditoría. Publicar mantiene la condición `missing`; esta pantalla nunca confirma fallecimientos.

## Reportes y posibles avistamientos

`/admin/avistamientos` contiene reportes `pending` o `escalated`. `/admin/posibles-avistamientos` redirige a esa ruta.

- Solo un reporte de tipo `sighting` puede aprobarse para publicación.
- La aprobación requiere ubicación y descripción públicas revisadas, sin contacto.
- Rechazar, duplicar, escalar o pedir información mantiene los datos privados.
- Aprobar un avistamiento no cambia la condición del caso.
- Los reportes de posible atrapamiento o posible fallecimiento nunca se convierten en estado oficial desde esta cola.

Las acciones escriben `moderation_actions` y `audit_logs`.

## Seguimiento de contactos

`/admin/seguimiento-contactos` reúne contacto inicial e informantes. `admin` y `moderator` pueden registrar llamadas, WhatsApp, SMS, correo, contacto presencial u otro método. `responder` solo lee.

Cada entrada contiene objetivo, método, estado, resumen privado y próxima fecha opcional. El historial no se edita ni borra; toda corrección debe ser una nueva entrada que explique la anterior. La plataforma registra la gestión, pero no envía mensajes automáticamente.

La sección `Mensajes y seguimiento` de `/admin/personas-pendientes` presenta el mismo principio como una conversación privada por caso: mensajes entrantes de la web, contactos autorizados y notas append-only. Para conectar a familiares e informantes, el equipo debe obtener consentimiento de ambas partes y nunca copiar sus datos a campos públicos.

## Retiro de una persona publicada

En `Gestionar publicadas`, un administrador puede retirar una card y su ficha del buscador. Debe buscar el caso, escribir una razón y confirmar expresamente la acción. El RPC `withdraw_person_case` archiva el caso y lo marca como retirado; conserva persona, reportes, contactos, historial y evidencia para trazabilidad. La acción registra `moderation_actions` y `audit_logs`. Moderadores pueden consultar el listado, pero no ejecutar el retiro.

## Fallecimientos oficiales

Solo `admin` usa `/admin/importar-fallecidos`. La fuente aceptada en el MVP es Medicina Legal. `source_reference` y justificación son obligatorias. Preview y confirmación vuelven a validar rol, datos y duplicados; el RPC establece `deceased_confirmed` únicamente junto con `authority_confirmed` y auditoría.

Una posible rectificación oficial no autoriza borrar historial. Debe implementarse o usarse un flujo admin expresamente auditado que preserve la referencia anterior y documente la corrección.
