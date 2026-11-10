-- =====================================================================
-- Club dei Mari · Staff — schema principale
-- Postgres 15+ / Supabase. Tutti gli identificativi sono UUID stabili.
-- Regola d'oro: ogni lettura e scrittura passa da RLS o da funzioni
-- SECURITY DEFINER che verificano ruolo e stato "attivo" sul database.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists private;          -- NON esposto dalle API
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- PROFILI STAFF
-- ---------------------------------------------------------------------
create table public.profiles (
  id                     uuid primary key references auth.users(id) on delete restrict,
  display_name           text not null check (length(trim(display_name)) between 1 and 60),
  active                 boolean not null default true,
  is_admin               boolean not null default false,   -- Mario: staff, turni, sostituzioni, accessi
  can_manage_workouts    boolean not null default false,   -- Fabio e Mario: allenamenti
  can_manage_attendance  boolean not null default false,   -- presenze effettive (Fabio solo se Mario conferma)
  must_change_password   boolean not null default true,
  created_at             timestamptz not null default now(),
  deactivated_at         timestamptz,
  deactivated_by         uuid references public.profiles(id) deferrable
);
comment on table public.profiles is 'Staff del club. Nessuna cancellazione: gli ex membri vengono disattivati.';

-- Dati di contatto visibili SOLO all''amministratore (minimizzazione)
create table public.profile_private (
  id     uuid primary key references public.profiles(id) on delete cascade,
  email  text not null,
  note   text
);

-- ---------------------------------------------------------------------
-- ATTIVITÀ (serate di allenamento, corsi, altro) E ASSEGNAZIONI
-- ---------------------------------------------------------------------
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  kind        text not null check (kind in ('allenamento','corso','altro')),
  title       text check (length(title) <= 80),
  start_time  time,
  end_time    time,
  notes       text check (length(notes) <= 1000),
  status      text not null default 'attiva' check (status in ('attiva','annullata')),
  provisional boolean not null default false,     -- "da verificare"
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.activities(date);

create table public.assignments (
  id            uuid primary key default gen_random_uuid(),
  activity_id   uuid not null references public.activities(id) on delete restrict,
  profile_id    uuid not null references public.profiles(id) on delete restrict,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,                       -- rimozione "morbida": lo storico resta
  removed_by    uuid references public.profiles(id),
  replaces_id   uuid references public.assignments(id) deferrable  -- sostituzione
);
create unique index assignments_one_active on public.assignments(activity_id, profile_id) where removed_at is null;
create index on public.assignments(profile_id);

-- «Ci sono» / «Non ci sono»: disponibilità dichiarata, NON presenza
create table public.availability_responses (
  assignment_id uuid primary key references public.assignments(id) on delete restrict,
  response      text not null check (response in ('ci_sono','non_ci_sono')),
  updated_at    timestamptz not null default now()
);

create table public.replacement_requests (
  id                      uuid primary key default gen_random_uuid(),
  assignment_id           uuid not null references public.assignments(id) on delete restrict,
  requested_by            uuid not null references public.profiles(id),
  status                  text not null default 'aperta' check (status in ('aperta','risolta','annullata')),
  replacement_profile_id  uuid references public.profiles(id),
  resolution_note         text check (length(resolution_note) <= 500),
  resolved_by             uuid references public.profiles(id),
  resolved_at             timestamptz,
  created_at              timestamptz not null default now()
);
create unique index replacement_one_open on public.replacement_requests(assignment_id) where status = 'aperta';

-- Presenza EFFETTIVA (registro). Nessuna riga = «Da verificare».
create table public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities(id) on delete restrict,
  profile_id   uuid not null references public.profiles(id) on delete restrict,
  status       text not null check (status in ('presente','assente')),
  note         text check (length(note) <= 300),
  recorded_by  uuid not null references public.profiles(id),
  recorded_at  timestamptz not null default now(),
  unique (activity_id, profile_id)
);

-- ---------------------------------------------------------------------
-- ALLENAMENTI: bozza → revisione → approvazione esplicita → pubblicazione
-- ---------------------------------------------------------------------
create table public.workouts (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null check (length(trim(title)) between 1 and 120),
  status                text not null default 'bozza' check (status in ('bozza','pubblicato','ritirato')),
  current_version_id    uuid,      -- ultima bozza salvata
  published_version_id  uuid,      -- versione approvata visibile allo staff
  share_original        boolean not null default false,  -- PDF originale consultabile dallo staff?
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  published_by          uuid references public.profiles(id),
  published_at          timestamptz
);

create table public.workout_versions (
  id           uuid primary key default gen_random_uuid(),
  workout_id   uuid not null references public.workouts(id) on delete restrict,
  version_no   int  not null,
  title        text not null check (length(trim(title)) between 1 and 120),
  summary      text check (length(summary) <= 500),
  blocks       jsonb not null default '[]'::jsonb,   -- [{title, body, uncertain, note}]
  source_text  text check (length(source_text) <= 100000),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  approved_by  uuid references public.profiles(id),
  approved_at  timestamptz,
  unique (workout_id, version_no),
  check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 200)
);
alter table public.workouts add constraint workouts_current_fk   foreign key (current_version_id)   references public.workout_versions(id) deferrable;
alter table public.workouts add constraint workouts_published_fk foreign key (published_version_id) references public.workout_versions(id) deferrable;

create table public.workout_files (
  id            uuid primary key default gen_random_uuid(),
  workout_id    uuid not null references public.workouts(id) on delete restrict,
  storage_path  text not null unique,
  filename      text not null check (length(filename) <= 200),
  size_bytes    int  not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by   uuid references public.profiles(id),
  uploaded_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- COMUNICAZIONI (semplici avvisi, non una chat)
-- ---------------------------------------------------------------------
create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) between 1 and 120),
  body        text not null check (length(body) <= 4000),
  archived    boolean not null default false,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- REGISTRO MODIFICHE (audit)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index on public.audit_log(at desc);
