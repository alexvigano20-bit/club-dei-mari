-- =====================================================================
-- Richieste del 10/11/2026
-- 1. Tipo di istruttore: segue i CORSI e/o gli ALLENAMENTI (oltre a
--    «scrive gli allenamenti» = can_manage_workouts, già esistente).
--    Mario può assegnare una persona solo alle attività che segue.
-- 2. STAGIONE: prima si definisce «quest'anno» (dal… al…), in che giorni
--    e orari ci sono allenamenti e corsi; l'app crea le serate. Poi Mario
--    assegna gli istruttori mese per mese.
-- =====================================================================

alter table public.profiles
  add column teaches_courses   boolean not null default true,
  add column teaches_trainings boolean not null default true;

create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 40),
  start_date  date not null,
  end_date    date not null,
  slots       jsonb not null default '[]'::jsonb,  -- [{kind, isodow, start, end}]
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date > start_date and end_date - start_date <= 400),
  check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 30)
);
alter table public.seasons enable row level security;
create policy seasons_read on public.seasons for select to authenticated using (private.is_active());
grant select on public.seasons to authenticated;
create trigger audit_seasons after insert or update or delete on public.seasons for each row execute function private.audit();

-- Le serate generate dalla stagione restano attività normali (si possono annullare, spostare, annotare)
alter table public.activities add column season_id uuid references public.seasons(id);

-- Assegnazione: rispetta il tipo di istruttore
create or replace function public.admin_assign(p_activity uuid, p_profile uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; k text;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile può assegnare i turni');
  select kind into k from public.activities where id = p_activity and status = 'attiva';
  perform private.require(k is not null, 'Attività non disponibile');
  perform private.require(exists(select 1 from public.profiles where id = p_profile and active
      and (k = 'altro' or (k = 'corso' and teaches_courses) or (k = 'allenamento' and teaches_trainings))),
    'Questa persona non segue questo tipo di attività (vedi Gestione Club → Gestisci)');
  select id into v_id from public.assignments where activity_id = p_activity and profile_id = p_profile and removed_at is null;
  if v_id is not null then return v_id; end if;
  insert into public.assignments(activity_id, profile_id, created_by) values (p_activity, p_profile, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Anagrafica: tipo di istruttore
create or replace function public.admin_set_roles(p_profile uuid, p_admin boolean, p_workouts boolean, p_courses boolean, p_trainings boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile gestisce i ruoli');
  perform private.require(p_courses or p_trainings or p_admin or p_workouts, 'Seleziona almeno un ruolo');
  update public.profiles set is_admin = p_admin, can_manage_workouts = p_workouts,
         teaches_courses = p_courses, teaches_trainings = p_trainings where id = p_profile;
end $$;

create or replace function public.admin_create_profile2(p_id uuid, p_name text, p_email text,
  p_workouts boolean, p_courses boolean, p_trainings boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile aggiunge membri dello staff');
  perform private.require(exists(select 1 from auth.users where id = p_id), 'Account non trovato');
  perform private.require(p_courses or p_trainings or p_workouts, 'Seleziona almeno un ruolo');
  insert into public.profiles(id, display_name, can_manage_workouts, teaches_courses, teaches_trainings)
  values (p_id, trim(p_name), coalesce(p_workouts,false), coalesce(p_courses,false), coalesce(p_trainings,false));
  insert into public.profile_private(id, email) values (p_id, lower(trim(p_email)));
end $$;

-- Stagione: salva e genera le serate. Ritorna {created, removed, kept_with_staff}.
-- Se si cambia un giorno/orario: le serate FUTURE non più previste e senza istruttori
-- assegnati vengono tolte; quelle con istruttori restano e vengono segnalate a Mario.
create or replace function public.admin_save_season(p_id uuid, p_name text, p_start date, p_end date, p_slots jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uuid; sl jsonb; d date; n_new int := 0; n_del int := 0; n_kept int := 0; today date := (now() at time zone 'Europe/Rome')::date;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile imposta la stagione');
  perform private.require(p_end > p_start and p_end - p_start <= 400, 'Date della stagione non valide (massimo 13 mesi)');
  perform private.require(jsonb_typeof(p_slots) = 'array' and jsonb_array_length(p_slots) between 1 and 30, 'Indica almeno un giorno');
  for sl in select * from jsonb_array_elements(p_slots) loop
    perform private.require((sl->>'kind') in ('allenamento','corso') and (sl->>'isodow')::int between 1 and 7
      and (sl->>'start')::time < (sl->>'end')::time, 'Giorni od orari non validi');
  end loop;
  perform private.require(not exists (select 1 from public.seasons where id is distinct from p_id
      and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')), 'Le date si sovrappongono a un''altra stagione');

  if p_id is null then
    insert into public.seasons(name, start_date, end_date, slots, created_by)
    values (trim(p_name), p_start, p_end, p_slots, auth.uid()) returning id into s;
  else
    update public.seasons set name = trim(p_name), start_date = p_start, end_date = p_end, slots = p_slots, updated_at = now()
     where id = p_id returning id into s;
    perform private.require(s is not null, 'Stagione inesistente');
  end if;

  -- 1) togli le serate future non più previste (solo se nessuno è assegnato)
  with stale as (
    select a.id, exists(select 1 from public.assignments x where x.activity_id = a.id) as staffed
      from public.activities a
     where a.season_id = s and a.date >= today and a.status = 'attiva'
       and (a.date < p_start or a.date > p_end or not exists (
             select 1 from jsonb_array_elements(p_slots) e
              where e->>'kind' = a.kind and (e->>'isodow')::int = extract(isodow from a.date)::int
                and (e->>'start')::time = a.start_time and (e->>'end')::time = a.end_time)))
  select count(*) filter (where staffed), count(*) filter (where not staffed) into n_kept, n_del from stale;
  delete from public.activities a where a.season_id = s and a.date >= today and a.status = 'attiva'
     and not exists(select 1 from public.assignments x where x.activity_id = a.id)
     and (a.date < p_start or a.date > p_end or not exists (
           select 1 from jsonb_array_elements(p_slots) e
            where e->>'kind' = a.kind and (e->>'isodow')::int = extract(isodow from a.date)::int
              and (e->>'start')::time = a.start_time and (e->>'end')::time = a.end_time));

  -- 2) crea le serate mancanti (dal giorno di oggi in poi, se la stagione è già iniziata)
  for d in select g::date from generate_series(greatest(p_start, today), p_end, interval '1 day') g loop
    for sl in select * from jsonb_array_elements(p_slots) e where (e->>'isodow')::int = extract(isodow from d)::int loop
      if not exists (select 1 from public.activities a where a.date = d and a.kind = sl->>'kind'
                      and a.start_time = (sl->>'start')::time) then
        insert into public.activities(date, kind, start_time, end_time, season_id)
        values (d, sl->>'kind', (sl->>'start')::time, (sl->>'end')::time, s);
        n_new := n_new + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('season_id', s, 'created', n_new, 'removed', n_del, 'kept_with_staff', n_kept);
end $$;

-- Lettura: profilo e stagioni nell'app
create or replace function public.app_seasons() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(s) - 'created_by' order by s.start_date desc), '[]') from public.seasons s
$$;

create or replace function public.app_state(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'me', public.whoami(),
    'server_time', now(),
    'seasons', public.app_seasons(),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'active',p.active,
                 'is_admin',p.is_admin,'can_manage_workouts',p.can_manage_workouts,
                 'teaches_courses',p.teaches_courses,'teaches_trainings',p.teaches_trainings)
                 order by p.display_name),'[]') from public.profiles p),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id',a.id,'date',a.date,'kind',a.kind,'title',a.title,'start_time',a.start_time,'end_time',a.end_time,
                 'notes',a.notes,'status',a.status,'provisional',a.provisional,'season_id',a.season_id,
                 'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'profile_id',s.profile_id,'replaces_id',s.replaces_id)
                                 order by s.created_at),'[]')
                                from public.assignments s where s.activity_id = a.id and s.removed_at is null))
                 order by a.date, a.start_time nulls first, a.kind),'[]')
               from public.activities a where a.date between p_from and p_to),
    'responses', (select coalesce(jsonb_object_agg(r.assignment_id, r.response),'{}') from public.availability_responses r),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'assignment_id',q.assignment_id,'requested_by',q.requested_by,
                 'status',q.status,'replacement_profile_id',q.replacement_profile_id,'resolution_note',q.resolution_note,
                 'created_at',q.created_at,'resolved_at',q.resolved_at,
                 'activity_id',s.activity_id,'date',a.date,'kind',a.kind,'title',a.title) order by a.date),'[]')
               from public.replacement_requests q join public.assignments s on s.id = q.assignment_id
               join public.activities a on a.id = s.activity_id
               where q.status = 'aperta' or q.resolved_at > now() - interval '30 days'),
    'announcements', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]')
               from (select id,title,body,created_at,created_by from public.announcements where not archived
                     order by created_at desc limit 50) n),
    'my_attendance', (select coalesce(jsonb_object_agg(r.activity_id, r.status),'{}')
               from public.attendance_records r where r.profile_id = auth.uid())
  )
$$;

do $$ declare f text; begin
  foreach f in array array['admin_assign(uuid,uuid)','admin_set_roles(uuid,boolean,boolean,boolean,boolean)',
    'admin_create_profile2(uuid,text,text,boolean,boolean,boolean)','admin_save_season(uuid,text,date,date,jsonb)',
    'app_seasons()','app_state(date,date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
