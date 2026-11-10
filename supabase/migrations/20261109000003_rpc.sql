-- =====================================================================
-- Club dei Mari · Staff — funzioni applicative (RPC)
-- Ogni funzione verifica i permessi sul database. Errori in italiano,
-- con codice P0001 (permesso/regola) o P0002 (conflitto).
-- =====================================================================

create or replace function private.require(ok boolean, msg text) returns void
language plpgsql as $$ begin if not coalesce(ok,false) then raise exception '%', msg using errcode = 'P0001'; end if; end $$;

-- ---------------------------------------------------------------------
-- Chi sono (usata all'avvio e periodicamente: se null → accesso revocato)
-- ---------------------------------------------------------------------
create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) - 'deactivated_by' from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.mark_password_changed() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false where id = auth.uid() and active
$$;

-- Mantiene il progetto attivo (piano gratuito): non restituisce dati
create or replace function public.ping() returns boolean language sql stable as $$ select true $$;

-- ---------------------------------------------------------------------
-- ISTRUTTORE: «Ci sono» / «Non ci sono» SOLO sui propri turni assegnati
-- ---------------------------------------------------------------------
create or replace function public.respond_assignment(p_assignment uuid, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  perform private.require(private.is_active(), 'Accesso non attivo');
  perform private.require(p_response in ('ci_sono','non_ci_sono'), 'Risposta non valida');
  select s.*, ac.date, ac.status as act_status into a
    from public.assignments s join public.activities ac on ac.id = s.activity_id
   where s.id = p_assignment;
  perform private.require(found and a.profile_id = auth.uid() and a.removed_at is null,
    'Puoi rispondere solo ai turni che Mario ti ha assegnato');
  perform private.require(a.act_status = 'attiva', 'Questa attività è stata annullata');
  perform private.require(a.date >= (now() at time zone 'Europe/Rome')::date, 'Il turno è già passato');

  insert into public.availability_responses(assignment_id, response, updated_at)
  values (p_assignment, p_response, now())
  on conflict (assignment_id) do update set response = excluded.response, updated_at = now();

  if p_response = 'non_ci_sono' then
    insert into public.replacement_requests(assignment_id, requested_by)
    values (p_assignment, auth.uid()) on conflict do nothing;
  else
    update public.replacement_requests set status = 'annullata', resolved_at = now(), resolved_by = auth.uid(),
           resolution_note = 'Annullata: l''istruttore ha confermato «Ci sono»'
     where assignment_id = p_assignment and status = 'aperta';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- MARIO: assegnazioni, sostituzioni, serie di attività
-- ---------------------------------------------------------------------
create or replace function public.admin_assign(p_activity uuid, p_profile uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile può assegnare i turni');
  perform private.require(exists(select 1 from public.profiles where id = p_profile and active), 'Istruttore non attivo');
  perform private.require(exists(select 1 from public.activities where id = p_activity and status = 'attiva'), 'Attività non disponibile');
  select id into v_id from public.assignments where activity_id = p_activity and profile_id = p_profile and removed_at is null;
  if v_id is not null then return v_id; end if;   -- nessun doppione
  insert into public.assignments(activity_id, profile_id, created_by) values (p_activity, p_profile, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_unassign(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile può togliere un turno');
  update public.assignments set removed_at = now(), removed_by = auth.uid()
   where id = p_assignment and removed_at is null;
  update public.replacement_requests set status = 'annullata', resolved_at = now(), resolved_by = auth.uid(),
         resolution_note = 'Turno rimosso dal responsabile'
   where assignment_id = p_assignment and status = 'aperta';
end $$;

create or replace function public.admin_resolve_replacement(p_request uuid, p_replacement uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r record; v_new uuid;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile sceglie il sostituto');
  select rr.*, s.activity_id into r from public.replacement_requests rr
    join public.assignments s on s.id = rr.assignment_id where rr.id = p_request for update of rr;
  perform private.require(found and r.status = 'aperta', 'Richiesta già chiusa');
  if p_replacement is not null then
    perform private.require(p_replacement <> r.requested_by, 'Scegli un istruttore diverso');
    update public.assignments set removed_at = now(), removed_by = auth.uid() where id = r.assignment_id and removed_at is null;
    v_new := public.admin_assign(r.activity_id, p_replacement);
    update public.assignments set replaces_id = r.assignment_id where id = v_new and replaces_id is null;
  end if;
  update public.replacement_requests set status = 'risolta', replacement_profile_id = p_replacement,
         resolution_note = left(p_note, 500), resolved_by = auth.uid(), resolved_at = now()
   where id = p_request;
  return v_new;
end $$;

-- Crea in un colpo le serate ricorrenti (es. lun/mer/ven) in un intervallo.
-- p_weekdays: 1=lunedì … 7=domenica (ISO). Non duplica attività già esistenti.
create or replace function public.admin_create_series(p_from date, p_to date, p_weekdays int[], p_kind text,
  p_title text default null, p_start time default null, p_end time default null, p_provisional boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare d date; n int := 0;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile crea il calendario');
  perform private.require(p_to >= p_from and p_to - p_from <= 400, 'Intervallo non valido (massimo 400 giorni)');
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    if extract(isodow from d)::int = any(p_weekdays) and not exists (
       select 1 from public.activities where date = d and kind = p_kind and coalesce(title,'') = coalesce(p_title,'') and status = 'attiva') then
      insert into public.activities(date, kind, title, start_time, end_time, provisional)
      values (d, p_kind, p_title, p_start, p_end, p_provisional);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- PRESENZE EFFETTIVE (registro). p_status null = torna «Da verificare»
-- ---------------------------------------------------------------------
create or replace function public.set_attendance(p_activity uuid, p_profile uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_attendance(), 'Non sei autorizzato a registrare le presenze');
  perform private.require(p_status is null or p_status in ('presente','assente'), 'Stato non valido');
  perform private.require(exists(select 1 from public.activities where id = p_activity), 'Attività inesistente');
  perform private.require(exists(select 1 from public.activities where id = p_activity
    and date <= (now() at time zone 'Europe/Rome')::date), 'La presenza effettiva si registra solo dal giorno dell''attività in poi');
  perform private.require(exists(select 1 from public.profiles where id = p_profile), 'Persona inesistente');
  if p_status is null then
    delete from public.attendance_records where activity_id = p_activity and profile_id = p_profile;
  else
    insert into public.attendance_records(activity_id, profile_id, status, note, recorded_by, recorded_at)
    values (p_activity, p_profile, p_status, left(p_note,300), auth.uid(), now())
    on conflict (activity_id, profile_id) do update
      set status = excluded.status, note = excluded.note, recorded_by = auth.uid(), recorded_at = now();
  end if;
end $$;

-- Righe del registro per un intervallo: assegnati + chiunque abbia una presenza registrata.
-- Conferma app e presenza verificata restano due colonne separate.
create or replace function public.attendance_sheet(p_from date, p_to date)
returns table(activity_id uuid, date date, kind text, title text, activity_status text,
              profile_id uuid, display_name text, assigned boolean,
              app_response text, attendance text, note text, recorded_by_name text, recorded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_attendance(), 'Non sei autorizzato a consultare il registro');
  return query
  with people as (
    select s.activity_id, s.profile_id, true as assigned, s.id as assignment_id
      from public.assignments s where s.removed_at is null
    union
    select r.activity_id, r.profile_id, false, null::uuid
      from public.attendance_records r
     where not exists (select 1 from public.assignments s2 where s2.activity_id = r.activity_id
                       and s2.profile_id = r.profile_id and s2.removed_at is null)
  )
  select a.id, a.date, a.kind, a.title, a.status, p.id, p.display_name, pe.assigned,
         ar.response, rec.status, rec.note, rb.display_name, rec.recorded_at
    from people pe
    join public.activities a on a.id = pe.activity_id
    join public.profiles p on p.id = pe.profile_id
    left join public.availability_responses ar on ar.assignment_id = pe.assignment_id
    left join public.attendance_records rec on rec.activity_id = a.id and rec.profile_id = p.id
    left join public.profiles rb on rb.id = rec.recorded_by
   where a.date between p_from and p_to
   order by a.date, a.kind, p.display_name;
end $$;

-- ---------------------------------------------------------------------
-- ALLENAMENTI (Fabio e Mario)
-- ---------------------------------------------------------------------
create or replace function private.valid_blocks(b jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(b) = 'array' and jsonb_array_length(b) <= 200 and not exists (
    select 1 from jsonb_array_elements(b) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e->'title') <> 'string'
        or length(e->>'title') > 200
        or (e ? 'body' and jsonb_typeof(e->'body') <> 'string')
        or length(coalesce(e->>'body','')) > 5000)
$$;

create or replace function public.create_workout(p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono creare allenamenti');
  insert into public.workouts(title, created_by) values (trim(p_title), auth.uid()) returning id into v;
  return v;
end $$;

-- Salva una nuova versione di bozza. p_base = versione da cui si è partiti:
-- se nel frattempo qualcun altro ha salvato, errore di conflitto (nessuna perdita silenziosa).
create or replace function public.save_workout_version(p_workout uuid, p_base uuid, p_title text, p_summary text,
  p_blocks jsonb, p_source text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w record; v uuid; n int;
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono modificare allenamenti');
  perform private.require(private.valid_blocks(p_blocks), 'Struttura della scheda non valida');
  select * into w from public.workouts where id = p_workout for update;
  perform private.require(found, 'Allenamento inesistente');
  if w.current_version_id is distinct from p_base then
    raise exception 'Qualcun altro ha salvato una versione più recente: ricarica prima di salvare' using errcode = 'P0002';
  end if;
  select coalesce(max(version_no),0)+1 into n from public.workout_versions where workout_id = p_workout;
  insert into public.workout_versions(workout_id, version_no, title, summary, blocks, source_text, created_by)
  values (p_workout, n, trim(p_title), p_summary, p_blocks, p_source, auth.uid()) returning id into v;
  update public.workouts set current_version_id = v, title = trim(p_title) where id = p_workout;
  return v;
end $$;

-- Pubblicazione SOLO con conferma esplicita della revisione umana
create or replace function public.publish_workout(p_workout uuid, p_version uuid, p_reviewed boolean, p_share_original boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono pubblicare');
  perform private.require(p_reviewed is true, 'Serve la conferma di aver controllato la scheda rispetto all''originale');
  perform private.require(exists(select 1 from public.workout_versions where id = p_version and workout_id = p_workout),
    'Versione non trovata');
  perform private.require(exists(select 1 from public.workouts where id = p_workout and current_version_id = p_version),
    'Stai pubblicando una versione non aggiornata: ricarica');
  update public.workout_versions set approved_by = auth.uid(), approved_at = now() where id = p_version;
  update public.workouts set status = 'pubblicato', published_version_id = p_version, share_original = coalesce(p_share_original,false),
         published_by = auth.uid(), published_at = now() where id = p_workout;
end $$;

create or replace function public.unpublish_workout(p_workout uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono ritirare una scheda');
  update public.workouts set status = 'ritirato' where id = p_workout and status = 'pubblicato';
end $$;

-- Registra un PDF già caricato nello storage privato (percorso workouts/<id>/...)
create or replace function public.register_workout_file(p_workout uuid, p_path text, p_filename text, p_size int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono caricare PDF');
  perform private.require(p_path like 'workouts/' || p_workout::text || '/%.pdf', 'Percorso file non valido');
  perform private.require(exists(select 1 from storage.objects o where o.bucket_id = 'workout-pdfs' and o.name = p_path),
    'Il file non risulta caricato');
  insert into public.workout_files(workout_id, storage_path, filename, size_bytes, uploaded_by)
  values (p_workout, p_path, left(p_filename,200), p_size, auth.uid()) returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- STAFF E ACCESSI (solo Mario). La parte "account" (creazione utente,
-- password, blocco sessioni) è nella funzione server admin-users, che
-- chiama queste RPC con il token di Mario: il permesso è verificato qui.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_profile(p_id uuid, p_name text, p_email text,
  p_workouts boolean default false, p_attendance boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile aggiunge membri dello staff');
  perform private.require(exists(select 1 from auth.users where id = p_id), 'Account non trovato');
  insert into public.profiles(id, display_name, can_manage_workouts, can_manage_attendance)
  values (p_id, trim(p_name), coalesce(p_workouts,false), coalesce(p_attendance,false));
  insert into public.profile_private(id, email) values (p_id, lower(trim(p_email)));
end $$;

create or replace function public.admin_set_active(p_profile uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile può disattivare o riattivare');
  perform private.require(p_profile <> auth.uid() or p_active, 'Non puoi disattivare te stesso');
  update public.profiles set active = p_active,
         deactivated_at = case when p_active then null else now() end,
         deactivated_by = case when p_active then null else auth.uid() end
   where id = p_profile;
  if not p_active then
    -- Le richieste aperte di chi esce vanno a Mario; lo storico resta intatto
    update public.replacement_requests set status = 'annullata', resolved_at = now(), resolved_by = auth.uid(),
           resolution_note = 'Membro disattivato' where requested_by = p_profile and status = 'aperta';
  end if;
end $$;

create or replace function public.admin_set_permissions(p_profile uuid, p_admin boolean, p_workouts boolean, p_attendance boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile gestisce i permessi');
  update public.profiles set is_admin = p_admin, can_manage_workouts = p_workouts, can_manage_attendance = p_attendance
   where id = p_profile;
end $$;

create or replace function public.admin_rename(p_profile uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile modifica l''anagrafica');
  update public.profiles set display_name = trim(p_name) where id = p_profile;
end $$;

create or replace function public.admin_require_password_change(p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile');
  update public.profiles set must_change_password = true where id = p_profile;
end $$;

-- Esportazione completa (JSON) per backup leggibile e migrazione
create or replace function public.admin_export_all() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile esporta i dati');
  return jsonb_build_object(
    'exported_at', now(), 'format', 'club-dei-mari-export-v1',
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.profiles t),
    'profile_private', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.profile_private t),
    'activities', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.activities t),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.assignments t),
    'availability_responses', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.availability_responses t),
    'replacement_requests', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.replacement_requests t),
    'attendance_records', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.attendance_records t),
    'workouts', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.workouts t),
    'workout_versions', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.workout_versions t),
    'workout_files', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.workout_files t),
    'announcements', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.announcements t),
    'audit_log', (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.audit_log t));
end $$;

-- Primo responsabile: eseguibile SOLO dall'editor SQL (non via API) e solo
-- se non esiste ancora alcun amministratore. Vedi docs/DEPLOY.md.
create or replace function private.bootstrap_admin(p_email text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if exists (select 1 from public.profiles where is_admin) then
    raise exception 'Esiste già un responsabile';
  end if;
  select id into v from auth.users where lower(email) = lower(p_email);
  if v is null then raise exception 'Crea prima l''utente in Authentication → Users'; end if;
  insert into public.profiles(id, display_name, is_admin, can_manage_workouts, can_manage_attendance)
  values (v, p_name, true, true, true);
  insert into public.profile_private(id, email) values (v, lower(p_email));
  return v;
end $$;
revoke all on function private.bootstrap_admin(text,text) from public, authenticated;

-- ---------------------------------------------------------------------
-- Permessi di esecuzione: niente agli anonimi, tranne ping()
-- ---------------------------------------------------------------------
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.ping() to anon;
revoke execute on function private.require(boolean,text) from public;
grant execute on function private.require(boolean,text) to authenticated;
