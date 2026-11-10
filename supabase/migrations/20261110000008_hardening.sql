-- Indicazioni del Security Advisor di Supabase: search_path fisso anche per le funzioni semplici.
-- (Gli avvisi «SECURITY DEFINER eseguibile dagli utenti» sono voluti: ogni funzione verifica
--  ruolo e stato attivo al suo interno; sono l'unico modo per scrivere dati.)
alter function public.ping() set search_path = '';
alter function private.valid_blocks(jsonb) set search_path = '';
alter function private.require(boolean, text) set search_path = '';
