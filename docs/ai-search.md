# Búsqueda con IA

La ruta `/api/ai-search` ejecuta OpenAI Responses en servidor. Su única herramienta es `search_people`, que llama a la búsqueda pública de Supabase. La interfaz renderiza las tarjetas con el JSON real de la base de datos; el modelo no crea tarjetas, personas ni estados. Si faltan variables de OpenAI, se desactiva de forma explícita y la búsqueda tradicional sigue disponible.
