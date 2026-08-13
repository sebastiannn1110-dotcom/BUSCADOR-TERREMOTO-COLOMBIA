# Búsqueda con IA

La ruta `/api/ai-search` ejecuta OpenAI Responses exclusivamente en el servidor. Su única herramienta es `search_people`, que llama a la búsqueda pública de Supabase. La interfaz renderiza las tarjetas con el JSON real de la base de datos; el modelo no crea tarjetas, personas ni estados.

La ruta acepta consultas de hasta 800 caracteres, rechaza teléfonos y correos, usa una ventana de abuso corta por huella hash no reversible y limita la salida y el tiempo de cada llamada. La consulta se envía a OpenAI únicamente para interpretar la búsqueda de casos publicados: no incluyas datos de contacto, direcciones exactas u otra información privada. Si faltan las variables de OpenAI, la ayuda se desactiva de forma explícita y la búsqueda tradicional sigue disponible.
