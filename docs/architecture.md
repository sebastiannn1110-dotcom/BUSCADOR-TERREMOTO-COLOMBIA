# Arquitectura

Next.js App Router renderiza las páginas públicas. El navegador solo usa la clave pública de Supabase y RPC de lectura/escritura específicamente limitadas. Las tablas con datos sensibles tienen RLS activado y no tienen políticas para usuarios anónimos.

Las rutas públicas consultan `search_public_people` y `get_public_case`; ambas devuelven la vista reducida `public_case_cards`. Los envíos crean registros pendientes mediante RPC y nunca cambian un estado oficial. La clave de servicio se reserva para operaciones administrativas del servidor y scripts locales.
