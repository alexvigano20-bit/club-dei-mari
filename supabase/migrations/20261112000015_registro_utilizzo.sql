-- =====================================================================
-- Registro di utilizzo (controllo di funzionamento)
-- Scopo unico: capire se l'app funziona e quali sezioni vengono usate.
-- Registra solo: apertura dell'app, sezione aperta, errori tecnici,
-- versione dell'app. Nessun contenuto (niente testi, note, dati del club),
-- nessuna posizione, nessun dato del telefono oltre al tipo di browser.
-- Conservazione: 90 giorni, poi cancellazione automatica.
-- Lettura: solo gli sviluppatori, direttamente dal database (pannello Supabase
-- o assistente). Nessun utente dell'app, nemmeno il responsabile, lo vede.
-- Le modifiche ai dati restano tracciate a parte in audit_log.
-- =====================================================================

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('apertura','sezione','errore')),
  view text check (char_length(view) <= 40),
  detail text check (char_length(detail) <= 300),
  app_version text check (char_length(app_version) <= 40),
  client text check (char_length(client) <= 40)
);
create index if not exists usage_events_at_idx on public.usage_events(at desc);
create index if not exists usage_events_profile_idx on public.usage_events(profile_id, at desc);

alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon, authenticated;
-- nessuna policy: dall'app non si legge (RLS attiva, nessun permesso)

-- Scrittura solo tramite questa funzione: utente attivo, al massimo 30 eventi per invio
-- e 600 al giorno per persona (un'app impazzita non riempie il database).
create or replace function public.log_usage(p_events jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e jsonb; n int;
begin
  if not private.is_active() or jsonb_typeof(p_events) <> 'array' then return; end if;
  select count(*) into n from public.usage_events where profile_id = auth.uid() and at > now() - interval '1 day';
  if n >= 600 then return; end if;
  for e in select value from jsonb_array_elements(p_events) limit 30 loop
    if e->>'kind' in ('apertura','sezione','errore') then
      insert into public.usage_events(profile_id, kind, view, detail, app_version, client)
      values (auth.uid(), e->>'kind', left(e->>'view', 40), left(e->>'detail', 300), left(e->>'v', 40), left(e->>'client', 40));
    end if;
  end loop;
end $$;

-- Riepilogo per gli sviluppatori (ultimi 30 giorni): select public.app_usage_report();
create or replace function public.app_usage_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'people', (select coalesce(jsonb_agg(x order by x->>'name'), '[]') from (
      select jsonb_build_object('name', p.display_name, 'active', p.active,
        'last_open', (select max(at) from public.usage_events u where u.profile_id = p.id and u.kind = 'apertura'),
        'days_30', (select count(distinct (at at time zone 'Europe/Rome')::date) from public.usage_events u where u.profile_id = p.id and u.at > now() - interval '30 days'),
        'errors_30', (select count(*) from public.usage_events u where u.profile_id = p.id and u.kind = 'errore' and u.at > now() - interval '30 days'),
        'version', (select app_version from public.usage_events u where u.profile_id = p.id order by at desc limit 1)) x
      from public.profiles p) s),
    'views', (select coalesce(jsonb_object_agg(view, n), '{}') from (
      select view, count(*) n from public.usage_events where kind = 'sezione' and at > now() - interval '30 days' group by view) v),
    'errors', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'name', (select display_name from public.profiles where id = u.profile_id),
        'view', view, 'detail', detail, 'v', app_version) order by at desc), '[]')
      from (select * from public.usage_events where kind = 'errore' and at > now() - interval '30 days' order by at desc limit 50) u)
  );
end $$;

create or replace function private.purge_usage_events() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.usage_events where at < now() - interval '90 days';
  get diagnostics n = row_count; return n;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cdm-purge-usage', '40 3 * * *', 'select private.purge_usage_events()');
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['log_usage(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.purge_usage_events() from public;
revoke all on function public.app_usage_report() from public, anon, authenticated;
