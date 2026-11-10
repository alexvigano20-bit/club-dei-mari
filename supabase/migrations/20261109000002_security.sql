-- =====================================================================
-- Club dei Mari · Staff — permessi, RLS, audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funzioni di controllo (schema privato, non chiamabili via API)
-- Leggono SEMPRE il database: una disattivazione ha effetto immediato
-- su ogni richiesta, anche con un token ancora valido.
-- ---------------------------------------------------------------------
create or replace function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.is_admin)
$$;

create or replace function private.can_workouts() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active
                 and (p.is_admin or p.can_manage_workouts))
$$;

create or replace function private.can_attendance() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active
                 and (p.is_admin or p.can_manage_attendance))
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------
-- Privilegi di base: anonimi NIENTE; autenticati solo SELECT, il resto
-- passa dalle funzioni RPC che verificano i permessi.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
-- Le sole scritture dirette consentite (sempre filtrate da RLS):
grant insert, update on public.activities    to authenticated;
grant insert, update on public.announcements to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, public;

-- RLS ovunque
alter table public.profiles               enable row level security;
alter table public.profile_private        enable row level security;
alter table public.activities             enable row level security;
alter table public.assignments            enable row level security;
alter table public.availability_responses enable row level security;
alter table public.replacement_requests   enable row level security;
alter table public.attendance_records     enable row level security;
alter table public.workouts               enable row level security;
alter table public.workout_versions       enable row level security;
alter table public.workout_files          enable row level security;
alter table public.announcements          enable row level security;
alter table public.audit_log              enable row level security;

-- PROFILI: lo staff attivo vede nomi e ruoli dei colleghi
create policy profiles_read on public.profiles for select to authenticated
  using (private.is_active());
-- Email e note: solo amministratore
create policy profile_private_read on public.profile_private for select to authenticated
  using (private.is_admin());

-- ATTIVITÀ: lettura staff attivo; scrittura solo amministratore
create policy activities_read   on public.activities for select to authenticated using (private.is_active());
create policy activities_insert on public.activities for insert to authenticated with check (private.is_admin());
create policy activities_update on public.activities for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- ASSEGNAZIONI: tutti vedono il calendario staff; modifiche solo via RPC admin
create policy assignments_read on public.assignments for select to authenticated using (private.is_active());

-- RISPOSTE: ognuno vede le proprie, l'amministratore tutte
create policy availability_read on public.availability_responses for select to authenticated
  using (private.is_admin() or (private.is_active() and exists (
    select 1 from public.assignments a where a.id = assignment_id and a.profile_id = auth.uid())));

-- SOSTITUZIONI: visibili allo staff attivo (come nella demo approvata)
create policy replacement_read on public.replacement_requests for select to authenticated using (private.is_active());

-- PRESENZE: gestori presenze tutte; ciascuno le proprie
create policy attendance_read on public.attendance_records for select to authenticated
  using (private.can_attendance() or (private.is_active() and profile_id = auth.uid()));

-- ALLENAMENTI: gestori vedono tutto; lo staff solo i pubblicati
create policy workouts_read on public.workouts for select to authenticated
  using (private.can_workouts() or (private.is_active() and status = 'pubblicato'));
create policy workout_versions_read on public.workout_versions for select to authenticated
  using (private.can_workouts() or (private.is_active() and exists (
    select 1 from public.workouts w where w.id = workout_id and w.status = 'pubblicato'
      and w.published_version_id = workout_versions.id)));
create policy workout_files_read on public.workout_files for select to authenticated
  using (private.can_workouts() or (private.is_active() and exists (
    select 1 from public.workouts w where w.id = workout_id and w.status = 'pubblicato' and w.share_original)));

-- COMUNICAZIONI: lettura staff; pubblicazione solo amministratore (decisione aperta)
create policy announcements_read   on public.announcements for select to authenticated using (private.is_active());
create policy announcements_insert on public.announcements for insert to authenticated
  with check (private.is_admin() and created_by = auth.uid());
create policy announcements_update on public.announcements for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- AUDIT: solo amministratore
create policy audit_read on public.audit_log for select to authenticated using (private.is_admin());

-- ---------------------------------------------------------------------
-- AUDIT TRIGGER
-- ---------------------------------------------------------------------
create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'assignment_id', to_jsonb(old)->>'assignment_id');
  insert into public.audit_log(actor, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, v_id, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','profile_private','activities','assignments','availability_responses',
                           'replacement_requests','attendance_records','workouts','workout_files','announcements']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function private.audit()', t);
  end loop;
end $$;

-- updated_at automatico
create or replace function private.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_activities before update on public.activities for each row execute function private.touch();
create trigger touch_workouts   before update on public.workouts   for each row execute function private.touch();

-- Sempre almeno un amministratore attivo (evita di chiudere fuori il club)
create or replace function private.keep_one_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where active and is_admin) then
    raise exception 'Deve restare almeno un responsabile attivo' using errcode = 'P0001';
  end if;
  return null;
end $$;
create trigger keep_one_admin after update or delete on public.profiles
  for each row execute function private.keep_one_admin();

-- Le note libere della tabella activities: blocchiamo il cambio di created_by
create or replace function private.activities_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid();
  else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
create trigger activities_guard before insert or update on public.activities
  for each row execute function private.activities_guard();
