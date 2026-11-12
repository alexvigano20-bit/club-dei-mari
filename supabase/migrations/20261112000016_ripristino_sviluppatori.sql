-- =====================================================================
-- Strumenti di ripristino per gli sviluppatori (schema «dev»)
-- Usabili SOLO dal database (assistente o pannello Supabase), mai dall'app:
-- lo schema dev non è esposto dall'API e nessun ruolo dell'app ha permessi.
--
--   Chi ha fatto cosa:        select * from dev.changes(since => now() - interval '2 days', who => 'Mario');
--   Fotografia manuale:        select dev.take_snapshot('prima di ...');
--   Fotografie disponibili:    select id, at, label from dev.snapshots order by at desc;
--   Ripristino (prova):        select * from dev.restore(<id>, array['turni']);            -- non cambia nulla
--   Ripristino (vero):         select * from dev.restore(<id>, array['turni'], dry_run => false);
--   Annulla le azioni di una persona da un certo momento (prova / vero):
--                              select * from dev.undo('Mario', since => '2026-11-20 21:00+01', groups => array['turni']);
--                              select * from dev.undo('Mario', since => ..., groups => ..., dry_run => false);
--
-- Gruppi: stagione, calendario, turni, presenze, disponibilita, allenamenti, bacheca, staff, tutto.
-- Ogni ripristino vero: prima scatta una fotografia di sicurezza, poi lavora in una sola
-- transazione e verifica che non restino collegamenti rotti (altrimenti annulla tutto).
-- Le operazioni passano dai normali trigger: anche i ripristini finiscono nel registro modifiche.
-- I PDF originali nell'archivio non vengono toccati (si ripristinano solo i dati).
-- =====================================================================

create schema if not exists dev;
revoke all on schema dev from public, anon, authenticated;

create table if not exists dev.snapshots (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  label text not null,
  automatic boolean not null default false,
  data jsonb not null
);

-- Tabelle ripristinabili in ordine «genitori prima dei figli», con chiave primaria
create or replace function dev.tables() returns table(ord int, t text, pk text[])
language sql immutable as $$
  values (1,'seasons',array['id']), (2,'profiles',array['id']), (3,'profile_private',array['id']),
         (4,'activities',array['id']), (5,'assignments',array['id']), (6,'availability_responses',array['assignment_id']),
         (7,'replacement_requests',array['id']), (8,'attendance_records',array['id']),
         (9,'declared_availability',array['profile_id','activity_id']), (10,'availability_notes',array['profile_id','month']),
         (11,'workouts',array['id']), (12,'workout_versions',array['id']), (13,'workout_files',array['id']),
         (14,'announcements',array['id'])
$$;

-- Gruppi comprensibili -> tabelle. Chi tocca il calendario tocca anche ciò che ne dipende.
create or replace function dev.group_tables(groups text[]) returns text[]
language sql immutable as $$
  select array(select distinct t from unnest(groups) g, lateral unnest(case g
    when 'stagione'      then array['seasons','activities','assignments','availability_responses','replacement_requests','attendance_records','declared_availability']
    when 'calendario'    then array['activities','assignments','availability_responses','replacement_requests','attendance_records','declared_availability']
    when 'turni'         then array['assignments','availability_responses','replacement_requests']
    when 'presenze'      then array['attendance_records']
    when 'disponibilita' then array['declared_availability','availability_notes']
    when 'allenamenti'   then array['workouts','workout_versions','workout_files']
    when 'bacheca'       then array['announcements']
    when 'staff'         then array['profiles','profile_private']
    when 'tutto'         then array(select t from dev.tables())
    else array['GRUPPO SCONOSCIUTO: ' || g] end) t)
$$;

create or replace function dev.take_snapshot(p_label text, p_automatic boolean default false) returns bigint
language plpgsql as $$
declare d jsonb := '{}'; r record; rows jsonb; v_id bigint;
begin
  for r in select * from dev.tables() order by ord loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', r.t) into rows;
    d := d || jsonb_build_object(r.t, rows);
  end loop;
  insert into dev.snapshots(label, automatic, data) values (p_label, p_automatic, d) returning id into v_id;
  -- conserva 30 fotografie automatiche e quelle manuali per 180 giorni
  delete from dev.snapshots where automatic and id not in (select id from dev.snapshots where automatic order by at desc limit 30);
  delete from dev.snapshots where not automatic and at < now() - interval '180 days';
  return v_id;
end $$;

-- Chiave di una riga (jsonb) secondo la chiave primaria
create or replace function dev.key_of(p_pk text[], p_row jsonb) returns jsonb
language sql immutable as $$ select jsonb_object_agg(k, p_row->k) from unnest(p_pk) k $$;

-- Inserisce o aggiorna una riga della tabella a partire dal suo jsonb
create or replace function dev.put_row(p_t text, p_pk text[], p_row jsonb) returns void
language plpgsql as $$
declare cols text[]; nonkey text[];
begin
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns
   where table_schema = 'public' and table_name = p_t and is_generated = 'NEVER' and identity_generation is null;
  nonkey := array(select c from unnest(cols) c where c <> all(p_pk));
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
                  on conflict (%3$s) do update set (%4$s) = row(%5$s)',
    p_t, (select string_agg(quote_ident(c), ',') from unnest(cols) c),
    (select string_agg(quote_ident(c), ',') from unnest(p_pk) c),
    (select string_agg(quote_ident(c), ',') from unnest(nonkey) c),
    (select string_agg('excluded.' || quote_ident(c), ',') from unnest(nonkey) c)) using p_row;
end $$;

create or replace function dev.del_row(p_t text, p_pk text[], p_row jsonb) returns void
language plpgsql as $$
begin
  execute format('delete from public.%1$I x where (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1))',
    p_t, (select string_agg(quote_ident(c), ',') from unnest(p_pk) c)) using p_row;
end $$;

-- Controllo finale: nessun collegamento rotto (riferimenti a righe inesistenti)
create or replace function dev.check_links() returns void
language plpgsql as $$
declare r record; n bigint;
begin
  for r in select c.conrelid::regclass child, c.confrelid::regclass parent,
                  (select string_agg(quote_ident(a.attname), ',' order by k.i) from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) ccols,
                  (select string_agg(quote_ident(a.attname), ',' order by k.i) from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) pcols
             from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace loop
    execute format('select count(*) from %s x where (%s) is not null and not exists (select 1 from %s y where (%s) = (x.%s))',
      r.child, replace(r.ccols, ',', ',x.'), r.parent, r.pcols, replace(r.ccols, ',', ',x.')) into n;
    if n > 0 then raise exception 'Ripristino annullato: % righe di % puntano a % inesistenti. Ripristina anche il gruppo collegato.', n, r.child, r.parent; end if;
  end loop;
end $$;

-- Ripristino da fotografia (completo o per gruppi). dry_run = solo conteggi.
create or replace function dev.restore(p_snapshot bigint, groups text[], dry_run boolean default true)
returns table(tabella text, da_cancellare bigint, da_inserire bigint, da_aggiornare bigint)
language plpgsql as $$
declare snap jsonb; tabs text[] := dev.group_tables(groups); r record; cur jsonb; s jsonb; x jsonb; safety bigint;
begin
  if exists (select 1 from unnest(tabs) t where t like 'GRUPPO SCONOSCIUTO%') then raise exception '%', tabs; end if;
  select data into snap from dev.snapshots where id = p_snapshot;
  if snap is null then raise exception 'Fotografia % inesistente', p_snapshot; end if;
  if not dry_run then
    safety := dev.take_snapshot(format('sicurezza prima del ripristino della fotografia %s (%s)', p_snapshot, array_to_string(groups, ', ')));
    perform set_config('cdm.restoring', 'on', true);
    set constraints all deferred;  -- collegamenti interni (sostituzioni) verificati alla fine
  end if;
  -- conteggi
  for r in select * from dev.tables() where t = any(tabs) order by ord loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', r.t) into cur;
    s := coalesce(snap->r.t, '[]');
    tabella := r.t;
    select count(*) into da_cancellare from jsonb_array_elements(cur) c where dev.key_of(r.pk, c.value) not in (select dev.key_of(r.pk, z.value) from jsonb_array_elements(s) z);
    select count(*) into da_inserire from jsonb_array_elements(s) z where dev.key_of(r.pk, z.value) not in (select dev.key_of(r.pk, c.value) from jsonb_array_elements(cur) c);
    select count(*) into da_aggiornare from jsonb_array_elements(s) z join jsonb_array_elements(cur) c on dev.key_of(r.pk, z.value) = dev.key_of(r.pk, c.value)
      where (z.value - 'updated_at') <> (c.value - 'updated_at');
    if r.t = 'profiles' then da_cancellare := 0; da_inserire := 0; end if; -- lo staff non si crea né si cancella da qui
    return next;
  end loop;
  if dry_run then return; end if;
  -- 1) cancellazioni: figli prima dei genitori (i profili non si cancellano mai)
  if 'workout_versions' = any(tabs) then  -- sgancia i puntatori verso versioni che spariranno
    update public.workouts w set current_version_id = null where current_version_id is not null
      and current_version_id::text not in (select z.value->>'id' from jsonb_array_elements(snap->'workout_versions') z);
    update public.workouts w set published_version_id = null where published_version_id is not null
      and published_version_id::text not in (select z.value->>'id' from jsonb_array_elements(snap->'workout_versions') z);
  end if;
  for r in select * from dev.tables() where t = any(tabs) and t not in ('profiles', 'profile_private') order by ord desc loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', r.t) into cur;
    for x in select c.value from jsonb_array_elements(cur) c where dev.key_of(r.pk, c.value) not in (select dev.key_of(r.pk, z.value) from jsonb_array_elements(coalesce(snap->r.t, '[]')) z) loop
      perform dev.del_row(r.t, r.pk, x);
    end loop;
  end loop;
  -- 2) inserimenti e aggiornamenti: genitori prima dei figli
  for r in select * from dev.tables() where t = any(tabs) order by ord loop
    for x in select z.value from jsonb_array_elements(coalesce(snap->r.t, '[]')) z loop
      if r.t in ('profiles', 'profile_private') and not exists (select 1 from public.profiles where id = (x->>'id')::uuid) then continue; end if;
      if r.t = 'workouts' then  -- le versioni arrivano dopo: puntatori sistemati al passo 3
        x := x || jsonb_build_object('current_version_id', (select current_version_id from public.workouts where id = (x->>'id')::uuid),
                                     'published_version_id', (select published_version_id from public.workouts where id = (x->>'id')::uuid));
      end if;
      perform dev.put_row(r.t, r.pk, x);
    end loop;
  end loop;
  -- 3) puntatori delle schede alle versioni
  if 'workouts' = any(tabs) then
    update public.workouts w set current_version_id = (z.value->>'current_version_id')::uuid, published_version_id = (z.value->>'published_version_id')::uuid
      from jsonb_array_elements(snap->'workouts') z where w.id = (z.value->>'id')::uuid;
  end if;
  perform dev.check_links();
  insert into public.audit_log(actor, table_name, row_id, action, new_data)
    values (null, 'dev', p_snapshot::text, 'ripristino', jsonb_build_object('gruppi', groups, 'fotografia_sicurezza', safety));
end $$;

-- Chi ha fatto cosa (registro modifiche leggibile)
create or replace function dev.changes(since timestamptz default now() - interval '7 days', who text default null, until timestamptz default now())
returns table(quando text, chi text, azione text, tabella text, riga text, prima jsonb, dopo jsonb)
language sql stable as $$
  select to_char(a.at at time zone 'Europe/Rome', 'DD/MM HH24:MI:SS'), coalesce(p.display_name, '(sistema)'), a.action, a.table_name, a.row_id,
         a.old_data - array['updated_at','created_at'], a.new_data - array['updated_at','created_at']
  from public.audit_log a left join public.profiles p on p.id = a.actor
  where a.at between since and until and (who is null or p.display_name ilike '%' || who || '%')
  order by a.at, a.id
$$;

-- Annulla le modifiche fatte da una persona da un certo momento (solo tabelle dei gruppi scelti)
create or replace function dev.undo(who text, since timestamptz, groups text[], dry_run boolean default true, until timestamptz default now())
returns table(quando text, azione text, tabella text, riga text, esito text)
language plpgsql as $$
declare tabs text[] := dev.group_tables(groups); actor_id uuid; a record; pk text[]; k jsonb; later int; safety bigint;
begin
  select id into actor_id from public.profiles where display_name ilike '%' || who || '%';
  if actor_id is null or (select count(*) from public.profiles where display_name ilike '%' || who || '%') > 1 then
    raise exception 'Persona «%» non trovata o non univoca', who; end if;
  if not dry_run then
    safety := dev.take_snapshot(format('sicurezza prima di annullare le modifiche di %s dal %s', who, since));
    perform set_config('cdm.restoring', 'on', true);
    set constraints all deferred;  -- collegamenti interni (sostituzioni) verificati alla fine
  end if;
  for a in select l.* from public.audit_log l where l.actor = actor_id and l.at between since and until and l.table_name = any(tabs)
           order by l.at desc, l.id desc loop
    select t.pk into pk from dev.tables() t where t.t = a.table_name;
    k := dev.key_of(pk, coalesce(a.new_data, a.old_data));
    -- qualcun altro ha modificato la stessa riga dopo? allora non la tocchiamo
    select count(*) into later from public.audit_log l2 where l2.table_name = a.table_name and l2.at > a.at and coalesce(l2.actor, '00000000-0000-0000-0000-000000000000') <> actor_id
      and dev.key_of(pk, coalesce(l2.new_data, l2.old_data)) = k and l2.action <> 'ripristino';
    quando := to_char(a.at at time zone 'Europe/Rome', 'DD/MM HH24:MI:SS'); azione := a.action; tabella := a.table_name; riga := k::text;
    if later > 0 then esito := 'SALTATA: modificata dopo da un''altra persona'; return next; continue; end if;
    esito := case a.action when 'insert' then 'da cancellare' when 'update' then 'da riportare com''era' else 'da ricreare' end;
    if not dry_run then
      begin
        if a.action = 'insert' then perform dev.del_row(a.table_name, pk, a.new_data);
        else perform dev.put_row(a.table_name, pk, a.old_data); end if;
        esito := replace(replace(replace(esito, 'da cancellare', 'cancellata'), 'da riportare com''era', 'riportata com''era'), 'da ricreare', 'ricreata');
      exception when foreign_key_violation then
        esito := 'SALTATA: altri dati (di altre persone) dipendono da questa riga';
      end;
    end if;
    return next;
  end loop;
  if not dry_run then
    perform dev.check_links();
    insert into public.audit_log(actor, table_name, row_id, action, new_data)
      values (null, 'dev', who, 'annullamento', jsonb_build_object('da', since, 'a', until, 'gruppi', groups, 'fotografia_sicurezza', safety));
  end if;
end $$;

-- In ripristino il guardiano del calendario non riscrive l'autore originale della serata
create or replace function private.activities_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('cdm.restoring', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid();
  else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;

-- Note sulle disponibilità: ora anche loro nel registro modifiche (per poterle annullare)
drop trigger if exists audit_availability_notes on public.availability_notes;
create trigger audit_availability_notes after insert or update or delete on public.availability_notes
  for each row execute function private.audit();

-- Nessun accesso dall'app, in nessun caso
revoke all on all tables in schema dev from public, anon, authenticated;
revoke all on all functions in schema dev from public, anon, authenticated;
alter default privileges in schema dev revoke all on functions from public, anon, authenticated;

-- Fotografia automatica ogni notte (ne restano 30) + una subito
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cdm-snapshot', '50 3 * * *', $c$select dev.take_snapshot('automatica notturna', true)$c$);
  end if;
end $$;
select dev.take_snapshot('prima fotografia (installazione strumenti di ripristino)');
