-- Dati DI PROVA per i test dell'interfaccia (nomi fittizi, nessun dato reale)
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-00000000000a','mario@prova.invalid'),
 ('10000000-0000-0000-0000-00000000000f','fabio@prova.invalid'),
 ('10000000-0000-0000-0000-0000000000b1','istruttore1@prova.invalid'),
 ('10000000-0000-0000-0000-0000000000b2','istruttore2@prova.invalid');
select private.bootstrap_admin('mario@prova.invalid','Mario (prova)');
set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-00000000000a',false);
select public.admin_create_profile('10000000-0000-0000-0000-00000000000f','Fabio (prova)','fabio@prova.invalid', true, false);
select public.admin_create_profile('10000000-0000-0000-0000-0000000000b1','Istruttore Prova Uno','istruttore1@prova.invalid');
select public.admin_create_profile('10000000-0000-0000-0000-0000000000b2','Istruttore Prova Due','istruttore2@prova.invalid');
select public.admin_create_series(date_trunc('month', current_date)::date, current_date + 75, array[1,3,5], 'allenamento', null, '21:00', '22:30', false);
select public.admin_create_series(date_trunc('month', current_date)::date, current_date + 75, array[2,6], 'corso', 'Corso base', '20:00', null, true);
select public.admin_assign(id, '10000000-0000-0000-0000-0000000000b1') from (select id from public.activities where kind='allenamento' and date >= current_date order by date limit 4) x;
select public.admin_assign(id, '10000000-0000-0000-0000-0000000000b2') from (select id from public.activities where kind='allenamento' and date >= current_date order by date offset 1 limit 4) x;
select public.admin_assign(id, '10000000-0000-0000-0000-00000000000a') from (select id from public.activities where kind='corso' and date >= current_date order by date limit 6) x;
select public.admin_assign(id, '10000000-0000-0000-0000-0000000000b1') from (select id from public.activities where kind='allenamento' and date < current_date order by date desc limit 2) x;
select public.admin_assign(id, '10000000-0000-0000-0000-0000000000b2') from (select id from public.activities where kind='allenamento' and date < current_date order by date desc limit 2) x;
select public.post_announcement('Benvenuti nella versione di prova', 'Questa è una comunicazione di esempio. I dati di questo ambiente sono fittizi.');
reset role;
update public.profiles set must_change_password = false where id <> '10000000-0000-0000-0000-0000000000b2';
