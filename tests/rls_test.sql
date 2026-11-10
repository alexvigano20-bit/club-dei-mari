-- =====================================================================
-- Test di sicurezza e flussi (database locale con shim Supabase)
-- Uso: ./scripts/local-db-reset.sh && psql ... -d cdm_test -f tests/rls_test.sql
-- =====================================================================
\set ON_ERROR_STOP 1
-- Le date del test seguono l'ora italiana, come l'app (in CI il server è in UTC)
set timezone = 'Europe/Rome';
create schema test;
create table test.results(n serial, name text, ok boolean, detail text);
grant usage on schema test to authenticated, anon; grant all on all tables in schema test to authenticated, anon;
grant all on all sequences in schema test to authenticated, anon;
create function test.ok(c boolean, name text) returns void language plpgsql as $$
begin insert into test.results(name, ok) values (name, coalesce(c,false)); end $$;
create function test.fails(q text, name text) returns void language plpgsql as $$
begin
  begin execute q; insert into test.results(name, ok, detail) values (name, false, 'nessun errore');
  exception when others then insert into test.results(name, ok, detail) values (name, true, sqlerrm); end;
end $$;
create function test.rows(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*) from (' || q || ') x' into n; return n; end $$;
grant execute on all functions in schema test to authenticated, anon;

-- Utenti di prova (nomi fittizi tranne i ruoli: NON dati reali)
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','mario@test.invalid'),
 ('00000000-0000-0000-0000-00000000000f','fabio@test.invalid'),
 ('00000000-0000-0000-0000-0000000000a1','istruttore1@test.invalid'),
 ('00000000-0000-0000-0000-0000000000a2','istruttore2@test.invalid'),
 ('00000000-0000-0000-0000-0000000000a3','istruttore3@test.invalid');
select private.bootstrap_admin('mario@test.invalid','Mario');
select test.fails($$select private.bootstrap_admin('fabio@test.invalid','X')$$, 'bootstrap: secondo responsabile rifiutato');

\set mario '00000000-0000-0000-0000-00000000000a'
\set fabio '00000000-0000-0000-0000-00000000000f'
\set i1 '00000000-0000-0000-0000-0000000000a1'
\set i2 '00000000-0000-0000-0000-0000000000a2'
\set i3 '00000000-0000-0000-0000-0000000000a3'

-- ANONIMO
set role anon;
select test.fails('select * from public.profiles', 'anon: niente accesso ai profili');
select test.fails('select * from public.activities', 'anon: niente accesso al calendario');
select test.fails($$select public.whoami()$$, 'anon: niente RPC');
select test.ok(public.ping(), 'anon: ping consentito (keep-alive)');
reset role;

-- MARIO crea lo staff
set role authenticated; select set_config('request.jwt.claim.sub', :'mario', false);
select test.ok((public.whoami()->>'is_admin')::boolean, 'Mario: whoami responsabile');
select public.admin_create_profile(:'fabio','Fabio','fabio@test.invalid', true, false);
select public.admin_create_profile(:'i1','Istruttore Uno','istruttore1@test.invalid');
select public.admin_create_profile(:'i2','Istruttore Due','istruttore2@test.invalid');
select public.admin_create_profile(:'i3','Istruttore Tre','istruttore3@test.invalid');
select test.ok(public.admin_create_series(current_date, current_date + 30, array[1,3,5], 'allenamento') between 12 and 14, 'Mario: serie lun/mer/ven creata');
select test.ok(public.admin_create_series(current_date, current_date + 30, array[1,3,5], 'allenamento') = 0, 'Serie: nessun doppione');
select public.admin_save_activity(null, current_date - 2, 'allenamento', 'Serata passata', null, null, null, false);
create temp table ids as select (select id from public.activities where date > current_date order by date limit 1) a1,
                               (select id from public.activities where date > current_date order by date offset 1 limit 1) a2,
                               (select id from public.activities where date = current_date - 2) p1;
grant select on ids to authenticated;
select public.admin_assign((select a1 from ids), :'i1');
select public.admin_assign((select a1 from ids), :'i1');
select public.admin_assign((select a1 from ids), :'i2');
select test.ok(test.rows('select 1 from public.assignments where removed_at is null') = 2, 'Assegnazione doppia non duplicata');
select test.fails($$select public.admin_set_active('00000000-0000-0000-0000-00000000000a', false)$$, 'Mario non può disattivare se stesso');
select test.fails($$select public.admin_set_permissions('00000000-0000-0000-0000-00000000000a', false, true, true)$$, 'Deve restare almeno un responsabile');

-- ISTRUTTORE 1
select set_config('request.jwt.claim.sub', :'i1', false);
select test.ok(test.rows('select 1 from public.activities') >= 12, 'Istruttore: vede il calendario staff');
select test.fails($$select public.admin_assign((select a2 from ids), '00000000-0000-0000-0000-0000000000a1')$$, 'Istruttore: NON può autoassegnarsi');
select test.fails($$insert into public.activities(date,kind) values (current_date+1,'corso')$$, 'Istruttore: NON crea attività');
select test.fails($$update public.profiles set is_admin = true where id = auth.uid()$$, 'Istruttore: NON si dà privilegi');
select test.fails($$update public.assignments set removed_at = now()$$, 'Istruttore: NON modifica assegnazioni');
select test.ok(test.rows('select 1 from public.profile_private') = 0, 'Istruttore: non vede le email dello staff');
select test.ok(test.rows('select 1 from public.audit_log') = 0, 'Istruttore: non vede il registro modifiche');
select test.fails($$select public.admin_export_all()$$, 'Istruttore: NON esporta i dati');
-- risposta sul proprio turno
select public.respond_assignment((select id from public.assignments where profile_id = auth.uid() and removed_at is null), 'ci_sono');
select test.fails($$select public.respond_assignment((select id from public.assignments where profile_id = '00000000-0000-0000-0000-0000000000a2'), 'ci_sono')$$, 'Istruttore: NON risponde per un collega');
select public.respond_assignment((select id from public.assignments where profile_id = auth.uid() and removed_at is null), 'non_ci_sono');
select test.ok(test.rows($$select 1 from public.replacement_requests where status='aperta'$$) = 1, '«Non ci sono» apre una richiesta di sostituzione');
select test.ok(test.rows('select 1 from public.availability_responses') = 1, 'Istruttore: vede solo la propria risposta');
select test.fails($$select public.set_attendance((select a1 from ids), auth.uid(), 'presente')$$, 'Istruttore: NON registra presenze');

-- ISTRUTTORE 2 vede la richiesta aperta ma non la risposta del collega
select set_config('request.jwt.claim.sub', :'i2', false);
select test.ok(test.rows($$select 1 from public.replacement_requests where status='aperta'$$) = 1, 'Staff: vede la sostituzione da organizzare');
select test.ok(test.rows('select 1 from public.availability_responses') = 0, 'Staff: non vede le risposte altrui');

-- MARIO sceglie il sostituto
select set_config('request.jwt.claim.sub', :'mario', false);
select public.admin_resolve_replacement((select id from public.replacement_requests where status='aperta'), :'i3', 'Concordato su WhatsApp');
select test.ok(test.rows($$select 1 from public.assignments where profile_id='00000000-0000-0000-0000-0000000000a3' and removed_at is null and replaces_id is not null$$) = 1, 'Sostituto assegnato e collegato al turno originale');
select test.ok(test.rows($$select 1 from public.assignments where profile_id='00000000-0000-0000-0000-0000000000a1'$$) = 1, 'Turno originale conservato nello storico');
select test.ok(test.rows($$select 1 from public.audit_log where table_name='assignments'$$) >= 4, 'Modifiche ai turni tracciate (audit)');

-- PRESENZE: Mario registra; istruttore 2 presente senza aver mai confermato
select test.fails($$select public.set_attendance((select a1 from ids), '00000000-0000-0000-0000-0000000000a2', 'presente')$$, 'Presenza effettiva non registrabile su date future');
select public.admin_assign((select p1 from ids), :'i2');
select public.admin_assign((select p1 from ids), :'i3');
select public.set_attendance((select p1 from ids), :'i2', 'presente', 'da registro cartaceo');
select public.set_attendance((select p1 from ids), :'i3', 'assente');
select test.ok(test.rows($$select 1 from public.attendance_sheet(current_date-5, current_date+30) where display_name='Istruttore Due' and app_response is null and attendance='presente'$$) = 1,
  'Presente senza conferma app: colonne distinte');
select test.ok(test.rows($$select 1 from public.attendance_sheet(current_date, current_date+30) where display_name='Istruttore Uno' and app_response='non_ci_sono' and attendance is null$$) = 0,
  'Assegnazione rimossa non compare nel registro');
select test.ok(test.rows($$select 1 from public.audit_log where table_name='attendance_records'$$) = 2, 'Modifiche alle presenze tracciate');

-- FABIO: senza permesso presenze finché Mario non lo concede
select set_config('request.jwt.claim.sub', :'fabio', false);
select test.fails($$select public.set_attendance((select a1 from ids), '00000000-0000-0000-0000-0000000000a2', 'assente')$$, 'Fabio: presenze bloccate finché non autorizzato');
select test.fails($$select public.attendance_sheet(current_date, current_date+30)$$, 'Fabio: registro bloccato finché non autorizzato');
select test.fails($$select public.admin_assign((select a2 from ids), '00000000-0000-0000-0000-00000000000f')$$, 'Fabio: NON assegna turni');

-- ALLENAMENTI
create temp table w as select public.create_workout('Novembre – Settimana 1') id;
grant select on w to authenticated;
select public.save_workout_version((select id from w), null, 'Novembre – Settimana 1', 'Distanza totale nuoto: 1100m',
  '[{"title":"Riscaldamento","body":"50m nuoto pinnato a stile"}]'::jsonb, 'testo originale');
select test.fails($$select public.save_workout_version((select id from w), null, 'x', null, '[]'::jsonb, null)$$, 'Conflitto di versione rilevato (nessuna sovrascrittura silenziosa)');
select test.fails($$select public.save_workout_version((select id from w), (select current_version_id from public.workouts where id=(select id from w)), 'x', null, '{"a":1}'::jsonb, null)$$, 'Struttura scheda non valida rifiutata');
insert into storage.objects(bucket_id, name) values ('workout-pdfs', 'workouts/' || (select id from w) || '/originale.pdf');
select public.register_workout_file((select id from w), 'workouts/' || (select id from w) || '/originale.pdf', 'Allenamenti.pdf', 120000);
select test.fails($$insert into storage.objects(bucket_id, name) values ('workout-pdfs', 'altro/x.pdf')$$, 'Storage: percorso non consentito');

select set_config('request.jwt.claim.sub', :'i1', false);
select test.ok(test.rows('select 1 from public.workouts') = 0, 'Istruttore: non vede le bozze');
select test.ok(test.rows('select 1 from public.workout_versions') = 0, 'Istruttore: non vede versioni non pubblicate');
select test.fails($$select public.create_workout('x')$$, 'Istruttore: NON crea allenamenti');
select test.fails($$insert into storage.objects(bucket_id, name) values ('workout-pdfs', 'workouts/' || (select id from w) || '/hack.pdf')$$, 'Istruttore: NON carica PDF');
select test.ok(test.rows($$select 1 from storage.objects where bucket_id='workout-pdfs'$$) = 0, 'Istruttore: PDF di bozza non accessibile');

select set_config('request.jwt.claim.sub', :'fabio', false);
select test.fails($$select public.publish_workout((select id from w), (select current_version_id from public.workouts where id=(select id from w)), false)$$, 'Pubblicazione senza revisione confermata rifiutata');
select public.publish_workout((select id from w), (select current_version_id from public.workouts where id=(select id from w)), true, false);
-- nuova bozza dopo la pubblicazione: lo staff continua a vedere la versione approvata
select public.save_workout_version((select id from w), (select current_version_id from public.workouts where id=(select id from w)), 'Novembre – Settimana 1', 'bozza', '[]'::jsonb, null);

select set_config('request.jwt.claim.sub', :'i1', false);
select test.ok(test.rows('select 1 from public.workouts') = 1, 'Istruttore: vede la scheda pubblicata');
select test.ok(test.rows('select 1 from public.workout_versions') = 1, 'Istruttore: vede solo la versione approvata, non la bozza successiva');
select test.ok(test.rows($$select 1 from storage.objects where bucket_id='workout-pdfs'$$) = 0, 'PDF originale non condiviso: non accessibile');
reset role;
select test.fails($$update public.workouts set share_original = true$$, 'PDF originale: condivisione con lo staff impossibile (decisione Mario)');
set role authenticated; select set_config('request.jwt.claim.sub', :'i1', false);
select test.ok(test.rows($$select 1 from public.workout_files$$) = 0, 'Istruttore: non vede i file originali');
select set_config('request.jwt.claim.sub', :'fabio', false);
select test.ok(test.rows($$select 1 from storage.objects where bucket_id='workout-pdfs'$$) = 1, 'Fabio: vede il PDF originale archiviato');

-- REVOCA: Mario disattiva l'istruttore 1
select set_config('request.jwt.claim.sub', :'mario', false);
select public.admin_set_active(:'i1', false);
select set_config('request.jwt.claim.sub', :'i1', false);   -- stesso token, ancora "valido"
select test.ok(public.whoami() is null, 'Revoca: whoami vuoto');
select test.ok(test.rows('select 1 from public.activities') = 0, 'Revoca: niente calendario');
select test.ok(test.rows('select 1 from public.assignments') = 0, 'Revoca: niente turni');
select test.ok(test.rows('select 1 from public.workouts') = 0, 'Revoca: niente allenamenti');
select test.ok(test.rows('select 1 from public.workout_versions') = 0, 'Revoca: niente schede');
select test.ok(test.rows('select 1 from public.announcements') = 0, 'Revoca: niente comunicazioni');
select test.ok(test.rows('select 1 from public.attendance_records') = 0, 'Revoca: niente presenze');
select test.ok(test.rows('select 1 from public.profiles') = 0, 'Revoca: niente anagrafica');
select test.ok(test.rows('select 1 from public.replacement_requests') = 0, 'Revoca: niente sostituzioni');
select test.ok(test.rows($$select 1 from storage.objects$$) = 0, 'Revoca: niente PDF né nuovi link firmati');
select test.fails($$select public.respond_assignment('00000000-0000-0000-0000-000000000000','ci_sono')$$, 'Revoca: niente scritture');
select set_config('request.jwt.claim.sub', :'mario', false);
select test.ok(test.rows($$select 1 from public.assignments where profile_id='00000000-0000-0000-0000-0000000000a1'$$) = 1, 'Revoca: storico conservato');
select public.admin_set_active(:'i1', true);
select set_config('request.jwt.claim.sub', :'i1', false);
select test.ok(public.whoami() is not null, 'Riattivazione: accesso ripristinato');

-- Presenze: solo Mario, anche se si tenta di dare il permesso a Fabio
select set_config('request.jwt.claim.sub', :'mario', false);
select public.admin_set_permissions(:'fabio', false, true, true);
select set_config('request.jwt.claim.sub', :'fabio', false);
select test.fails($$select public.set_attendance((select p1 from ids), '00000000-0000-0000-0000-0000000000a2', 'assente')$$, 'Fabio: presenze sempre bloccate (solo Mario)');
select test.ok((public.whoami()->>'can_manage_workouts')::boolean, 'Fabio: mantiene la gestione allenamenti');

-- Turni rapidi: tutti i lunedì/mercoledì/venerdì di un periodo
select set_config('request.jwt.claim.sub', :'mario', false);
select test.ok(public.admin_assign_weekday(:'i3', current_date, current_date + 30, extract(isodow from (select date from public.activities where id=(select a2 from ids)))::int, 'allenamento') >= 4, 'Mario: assegna una persona a tutti i giorni X del periodo');
select test.ok(public.admin_assign_weekday(:'i3', current_date, current_date + 30, extract(isodow from (select date from public.activities where id=(select a2 from ids)))::int, 'allenamento') = 0, 'Assegnazione rapida: nessun doppione');
select set_config('request.jwt.claim.sub', :'i1', false);
select test.fails($$select public.admin_assign_weekday('00000000-0000-0000-0000-0000000000a1', current_date, current_date+30, 1, 'allenamento')$$, 'Istruttore: NON usa l''assegnazione rapida');

-- Conservazione presenze 12 mesi
select set_config('request.jwt.claim.sub', :'mario', false);
select public.admin_save_activity(null, current_date - 400, 'allenamento', 'Vecchia', null, null, null, false);
select public.set_attendance((select id from public.activities where title='Vecchia'), :'i2', 'presente');
select test.ok(public.admin_purge_expired_attendance() = 1, 'Pulizia: cancellata la presenza oltre 12 mesi');
select test.ok(test.rows($$select 1 from public.attendance_records$$) = 2, 'Pulizia: presenze recenti conservate');
select test.ok(test.rows($$select 1 from public.audit_log where table_name='attendance_records' and coalesce(new_data,old_data)->>'activity_id' = (select id::text from public.activities where title='Vecchia')$$) = 0, 'Pulizia: i dati cancellati non restano nello storico');
select set_config('request.jwt.claim.sub', :'i1', false);
select test.fails($$select public.admin_purge_expired_attendance()$$, 'Istruttore: NON avvia la pulizia');

-- Tipi di istruttore e stagione
select set_config('request.jwt.claim.sub', :'mario', false);
select public.admin_set_roles(:'i2', false, false, true, false);   -- solo corsi
select test.fails($$select public.admin_assign((select a2 from ids), '00000000-0000-0000-0000-0000000000a2')$$, 'Istruttore solo corsi: non assegnabile agli allenamenti');
select test.fails($$select public.admin_set_roles('00000000-0000-0000-0000-0000000000a2', false, false, false, false)$$, 'Ruoli: almeno uno obbligatorio');
create temp table ss as select public.admin_save_season(null, '2026/2027', current_date + 60, current_date + 120,
  '[{"kind":"allenamento","isodow":2,"start":"21:00","end":"22:30"},{"kind":"corso","isodow":4,"start":"20:00","end":"21:30"}]'::jsonb) r;
grant select on ss to authenticated;
select test.ok(((select r from ss)->>'created')::int between 16 and 20, 'Stagione: serate generate da giorni e orari');
select test.ok(test.rows($$select 1 from public.activities where season_id is not null and kind='corso' and extract(isodow from date)=4 and start_time='20:00'$$) between 8 and 10, 'Stagione: corsi il giorno e all''ora indicati');
select public.admin_assign((select id from public.activities where season_id is not null and kind='corso' order by date limit 1), :'i2');
create temp table ss2 as select public.admin_save_season((select (r->>'season_id')::uuid from ss), '2026/2027', current_date + 60, current_date + 120,
  '[{"kind":"allenamento","isodow":3,"start":"21:00","end":"22:30"}]'::jsonb) r;
grant select on ss2 to authenticated;
select test.ok(((select r from ss2)->>'kept_with_staff')::int = 1 and ((select r from ss2)->>'removed')::int >= 15, 'Stagione modificata: serate tolte, quelle con istruttori conservate e segnalate');
select test.fails($$select public.admin_save_season(null, 'x', current_date + 70, current_date + 90, '[{"kind":"corso","isodow":1,"start":"20:00","end":"21:00"}]'::jsonb)$$, 'Stagioni sovrapposte rifiutate');
select set_config('request.jwt.claim.sub', :'i1', false);
select test.fails($$select public.admin_save_season(null, 'x', current_date + 500, current_date + 600, '[{"kind":"corso","isodow":1,"start":"20:00","end":"21:00"}]'::jsonb)$$, 'Istruttore: NON imposta la stagione');
select test.ok(test.rows($$select 1 from public.seasons$$) = 1, 'Staff: vede la stagione');

-- La stagione adotta le serate inserite a mano senza orario
select set_config('request.jwt.claim.sub', :'mario', false);
select public.admin_save_activity(null, current_date + 200, 'corso', null, null, null, null, false);
create temp table ss3 as select public.admin_save_season(null, 'Prossima', current_date + 195, current_date + 205,
  jsonb_build_array(jsonb_build_object('kind','corso','isodow',extract(isodow from current_date + 200)::int,'start','20:00','end','21:30'))) r;
grant select on ss3 to authenticated;
select test.ok(((select r from ss3)->>'adopted')::int = 1 and test.rows($$select 1 from public.activities where date = current_date + 200 and kind='corso'$$) = 1, 'Stagione: serata già inserita adottata, nessun doppione');

-- Disponibilità dichiarate
select set_config('request.jwt.claim.sub', :'fabio', false);
create temp table av as select array_agg(id order by date) ids from public.activities where kind='allenamento' and date > current_date and date <= current_date + 30;
grant select on av to authenticated;
select test.ok(public.set_my_availability((select ids[1:3] from av), false) = 3, 'Staff: dichiara le serate in cui NON c''è');
select public.set_my_availability((select ids[4:5] from av), true);
select public.set_my_availability_note(current_date, 'Lavoro a turni: il martedì finisco alle 22');
select test.fails($$select public.set_my_availability(array[(select id from public.activities where date < current_date limit 1)], true)$$, 'Disponibilità: niente dichiarazioni su serate passate');
select test.ok(test.rows($$select 1 from public.declared_availability$$) = 5, 'Staff: vede le proprie disponibilità');
select set_config('request.jwt.claim.sub', :'i1', false);
select test.ok(test.rows($$select 1 from public.declared_availability$$) = 0 and test.rows($$select 1 from public.availability_notes$$) = 0, 'Staff: non vede le disponibilità altrui');
select set_config('request.jwt.claim.sub', :'mario', false);
select test.ok(test.rows($$select 1 from public.declared_availability$$) = 5 and test.rows($$select 1 from public.availability_notes$$) = 1, 'Mario: vede tutte le disponibilità e le note');
select test.ok(((public.app_availability(current_date, current_date + 40))->'items') is not null, 'Mario: lettura disponibilità per l''app');
create temp table aw as select public.admin_assign_weekday(:'fabio', current_date, current_date + 30, extract(isodow from (select date from public.activities where id = (select ids[1] from av)))::int, 'allenamento') n;
select test.ok(not exists (select 1 from public.assignments s where s.profile_id = '00000000-0000-0000-0000-00000000000f' and s.removed_at is null and s.activity_id = (select ids[1] from av))
  and (select n from aw) >= 1,
  'Assegnazione rapida: salta le serate dichiarate «non ci sono»');

reset role;
\echo
select case when ok then 'OK   ' else 'FAIL ' end || name || coalesce('  ['||detail||']','') as risultato from test.results order by n;
select count(*) filter (where ok) as superati, count(*) filter (where not ok) as falliti from test.results;
