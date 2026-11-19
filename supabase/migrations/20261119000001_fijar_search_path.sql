-- Recomendación del revisor de seguridad de Supabase: fijar search_path en la función del trigger.
alter function public.tocar_actualizado() set search_path = public;
