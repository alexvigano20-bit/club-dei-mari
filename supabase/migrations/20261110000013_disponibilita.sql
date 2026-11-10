-- =====================================================================
-- Disponibilità dichiarate (richiesta del 10/11/2026)
-- Mario imposta la stagione; ogni membro dello staff dichiara, mese per
-- mese, in quali serate c'è e in quali no (lavoro a turni, viaggi…), con
-- una nota libera per il mese. Mario vede le disponibilità quando assegna.
-- Nessuna dichiarazione = «non dichiarato» (non è un no).
-- =====================================================================

create table public.declared_availability (
  profile_id   uuid not null references public.profiles(id) on delete restrict,
  activity_id  uuid not null references public.activities(id) on delete cascade,
  available    boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (profile_id, activity_id)
);
create index on public.declared_availability(activity_id);

create table public.availability_notes (
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  month       date not null check (extract(day from month) = 1),
  note        text not null check (length(note) <= 500),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, month)
);

alter table public.declared_availability enable row level security;
alter table public.availability_notes   enable row level security;
-- ognuno vede le proprie; il responsabile tutte
create policy avail_read on public.declared_availability for select to authenticated
  using (private.is_admin() or (private.is_active() and profile_id = auth.uid()));
create policy avail_notes_read on public.availability_notes for select to authenticated
  using (private.is_admin() or (private.is_active() and profile_id = auth.uid()));
grant select on public.declared_availability, public.availability_notes to authenticated;

-- Dichiara (true/false) o cancella (null) la disponibilità propria su più serate future
create or replace function public.set_my_availability(p_activities uuid[], p_available boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; today date := (now() at time zone 'Europe/Rome')::date;
begin
  perform private.require(private.is_active(), 'Accesso non attivo');
  perform private.require(coalesce(array_length(p_activities, 1), 0) between 1 and 200, 'Nessuna serata indicata');
  perform private.require(not exists (select 1 from unnest(p_activities) x(id)
      where not exists (select 1 from public.activities a where a.id = x.id and a.date >= today)),
    'Puoi dichiarare la disponibilità solo per serate future');
  if p_available is null then
    delete from public.declared_availability where profile_id = auth.uid() and activity_id = any(p_activities);
  else
    insert into public.declared_availability(profile_id, activity_id, available, updated_at)
    select auth.uid(), x, p_available, now() from unnest(p_activities) x
    on conflict (profile_id, activity_id) do update set available = excluded.available, updated_at = now();
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.set_my_availability_note(p_month date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_active(), 'Accesso non attivo');
  if coalesce(trim(p_note), '') = '' then
    delete from public.availability_notes where profile_id = auth.uid() and month = date_trunc('month', p_month)::date;
  else
    insert into public.availability_notes(profile_id, month, note) values (auth.uid(), date_trunc('month', p_month)::date, left(trim(p_note), 500))
    on conflict (profile_id, month) do update set note = excluded.note, updated_at = now();
  end if;
end $$;

-- Assegnazione rapida: salta le serate in cui la persona ha dichiarato «no»
create or replace function public.admin_assign_weekday(p_profile uuid, p_from date, p_to date, p_isodow int, p_kind text)
returns int language plpgsql security definer set search_path = '' as $$
declare a record; n int := 0;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile può assegnare i turni');
  perform private.require(p_to >= p_from and p_to - p_from <= 400, 'Intervallo non valido');
  for a in select id from public.activities where date between p_from and p_to and status = 'attiva' and kind = p_kind
             and extract(isodow from date)::int = p_isodow
             and not exists (select 1 from public.assignments s where s.activity_id = activities.id and s.profile_id = p_profile and s.removed_at is null)
             and not exists (select 1 from public.declared_availability d where d.activity_id = activities.id and d.profile_id = p_profile and not d.available)
  loop
    perform public.admin_assign(a.id, p_profile); n := n + 1;
  end loop;
  return n;
end $$;

-- Lettura per l'app (RLS: proprie per tutti, tutte per il responsabile)
create or replace function public.app_availability(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('p', d.profile_id, 'a', d.activity_id, 'v', d.available)), '[]')
              from public.declared_availability d join public.activities a on a.id = d.activity_id
              where a.date between p_from and p_to),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('p', n.profile_id, 'm', n.month, 'note', n.note)), '[]')
              from public.availability_notes n where n.month between date_trunc('month', p_from)::date and p_to))
$$;

create trigger audit_declared_availability after insert or update or delete on public.declared_availability
  for each row execute function private.audit();

do $$ declare f text; begin
  foreach f in array array['set_my_availability(uuid[],boolean)','set_my_availability_note(date,text)',
    'admin_assign_weekday(uuid,date,date,int,text)','app_availability(date,date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Esportazione completa: includere anche le disponibilità
create or replace function public.admin_export_all() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile esporta i dati');
  return jsonb_build_object(
    'exported_at', now(), 'format', 'club-dei-mari-export-v2',
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.profiles t),
    'profile_private', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.profile_private t),
    'seasons', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.seasons t),
    'activities', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.activities t),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.assignments t),
    'availability_responses', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.availability_responses t),
    'declared_availability', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.declared_availability t),
    'availability_notes', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.availability_notes t),
    'replacement_requests', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.replacement_requests t),
    'attendance_records', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.attendance_records t),
    'workouts', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.workouts t),
    'workout_versions', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.workout_versions t),
    'workout_files', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.workout_files t),
    'announcements', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.announcements t),
    'audit_log', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.audit_log t));
end $$;
