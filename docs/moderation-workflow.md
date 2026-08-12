# Moderación

1. Inicie sesión en Supabase Auth y asigne un rol en `profiles`.
2. Revise reportes pendientes y urgentes en una interfaz administrativa autenticada (el acceso a las tablas está restringido por RLS).
3. Registre una razón al aprobar, rechazar, escalar o deduplicar.
4. Solo un `admin` puede establecer `deceased_confirmed`, con `authority_confirmed`, razón y referencia de autoridad privada. Cada transición se registra en historial y auditoría.
