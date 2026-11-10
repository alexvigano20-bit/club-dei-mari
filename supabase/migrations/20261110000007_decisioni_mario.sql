-- =====================================================================
-- Decisioni di Mario (10/11/2026)
-- 1. Le presenze effettive le registra ed esporta SOLO il responsabile.
-- 2. Il PDF originale degli allenamenti NON è mai visibile allo staff
--    (resta archiviato per Fabio e Mario).
-- 3. Le presenze si conservano 12 mesi, poi vengono cancellate.
-- 4. Turni inseriti da Mario: assegnazione rapida "tutti i lunedì del mese".
-- =====================================================================

-- 1. PRESENZE: solo responsabile ------------------------------------------
create or replace function private.can_attendance() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
$$;
update public.profiles set can_manage_attendance = false where can_manage_attendance;
alter table public.profiles add constraint attendance_only_admin check (not can_manage_attendance);

create or replace function public.admin_set_permissions(p_profile uuid, p_admin boolean, p_workouts boolean, p_attendance boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile gestisce i permessi');
  update public.profiles set is_admin = p_admin, can_manage_workouts = p_workouts where id = p_profile;
end $$;

create or replace function public.admin_create_profile(p_id uuid, p_name text, p_email text,
  p_workouts boolean default false, p_attendance boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile aggiunge membri dello staff');
  perform private.require(exists(select 1 from auth.users where id = p_id), 'Account non trovato');
  insert into public.profiles(id, display_name, can_manage_workouts) values (p_id, trim(p_name), coalesce(p_workouts,false));
  insert into public.profile_private(id, email) values (p_id, lower(trim(p_email)));
end $$;

-- 2. PDF ORIGINALE: solo Fabio e Mario ------------------------------------
update public.workouts set share_original = false where share_original;
alter table public.workouts add constraint original_never_shared check (not share_original);

drop policy if exists workout_files_read on public.workout_files;
create policy workout_files_read on public.workout_files for select to authenticated using (private.can_workouts());

drop policy if exists "pdf_read_authorized" on storage.objects;
create policy "pdf_read_managers" on storage.objects for select to authenticated
  using (bucket_id = 'workout-pdfs' and private.can_workouts());

create or replace function public.publish_workout(p_workout uuid, p_version uuid, p_reviewed boolean, p_share_original boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono pubblicare');
  perform private.require(p_reviewed is true, 'Serve la conferma di aver controllato la scheda rispetto all''originale');
  perform private.require(exists(select 1 from public.workout_versions where id = p_version and workout_id = p_workout), 'Versione non trovata');
  perform private.require(exists(select 1 from public.workouts where id = p_workout and current_version_id = p_version),
    'Stai pubblicando una versione non aggiornata: ricarica');
  update public.workout_versions set approved_by = auth.uid(), approved_at = now() where id = p_version;
  update public.workouts set status = 'pubblicato', published_version_id = p_version,
         published_by = auth.uid(), published_at = now() where id = p_workout;
end $$;

-- 3. CONSERVAZIONE PRESENZE 12 MESI ---------------------------------------
-- Durante la pulizia il registro modifiche non duplica i dati cancellati.
create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  if current_setting('cdm.purging', true) = 'on' then return coalesce(new, old); end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'assignment_id', to_jsonb(old)->>'assignment_id');
  insert into public.audit_log(actor, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, v_id, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Cancella presenze (e relative voci di storico) di attività più vecchie di 12 mesi.
create or replace function private.purge_expired_attendance() returns int
language plpgsql security definer set search_path = '' as $$
declare n int; cutoff date := ((now() at time zone 'Europe/Rome')::date - interval '12 months')::date;
begin
  perform set_config('cdm.purging', 'on', true);
  delete from public.attendance_records r using public.activities a where a.id = r.activity_id and a.date < cutoff;
  get diagnostics n = row_count;
  delete from public.audit_log l where l.table_name = 'attendance_records' and (l.at < now() - interval '12 months'
    or exists (select 1 from public.activities a where a.id::text = coalesce(l.new_data, l.old_data)->>'activity_id' and a.date < cutoff));
  perform set_config('cdm.purging', 'off', true);
  return n;
end $$;
revoke all on function private.purge_expired_attendance() from public, authenticated;

-- Avvio manuale da Gestione Club (oltre al job automatico)
create or replace function public.admin_purge_expired_attendance() returns int
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile');
  return private.purge_expired_attendance();
end $$;

-- Job automatico notturno se pg_cron è disponibile (su Supabase lo è)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cdm-purge-attendance', '30 3 * * *', 'select private.purge_expired_attendance()');
  else
    raise notice 'pg_cron non disponibile: la pulizia va avviata da Gestione Club';
  end if;
end $$;

-- 4. TURNI: assegna una persona a tutti i giorni X di un periodo ----------
-- es. Aldo a tutti i mercoledì di dicembre. Non duplica, salta le annullate.
create or replace function public.admin_assign_weekday(p_profile uuid, p_from date, p_to date, p_isodow int, p_kind text)
returns int language plpgsql security definer set search_path = '' as $$
declare a record; n int := 0;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile può assegnare i turni');
  perform private.require(p_to >= p_from and p_to - p_from <= 400, 'Intervallo non valido');
  for a in select id from public.activities where date between p_from and p_to and status = 'attiva' and kind = p_kind
             and extract(isodow from date)::int = p_isodow
             and not exists (select 1 from public.assignments s where s.activity_id = activities.id and s.profile_id = p_profile and s.removed_at is null)
  loop
    perform public.admin_assign(a.id, p_profile); n := n + 1;
  end loop;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_set_permissions(uuid,boolean,boolean,boolean)','admin_create_profile(uuid,text,text,boolean,boolean)',
    'publish_workout(uuid,uuid,boolean,boolean)','admin_purge_expired_attendance()','admin_assign_weekday(uuid,date,date,int,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Primo responsabile (versione aggiornata: il permesso presenze deriva dal ruolo)
create or replace function private.bootstrap_admin(p_email text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if exists (select 1 from public.profiles where is_admin) then raise exception 'Esiste già un responsabile'; end if;
  select id into v from auth.users where lower(email) = lower(p_email);
  if v is null then raise exception 'Crea prima l''utente in Authentication → Users'; end if;
  insert into public.profiles(id, display_name, is_admin, can_manage_workouts) values (v, p_name, true, true);
  insert into public.profile_private(id, email) values (v, lower(p_email));
  return v;
end $$;
revoke all on function private.bootstrap_admin(text,text) from public, authenticated;
