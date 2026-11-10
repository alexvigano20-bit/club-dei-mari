-- La stagione adotta le serate già inserite a mano senza orario (stessa data e tipo),
-- invece di crearne un doppione.
create or replace function public.admin_save_season(p_id uuid, p_name text, p_start date, p_end date, p_slots jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uuid; sl jsonb; d date; n_new int := 0; n_del int := 0; n_kept int := 0; n_adopt int := 0; today date := (now() at time zone 'Europe/Rome')::date;
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
      -- serata già inserita a mano senza orario: viene adottata dalla stagione (niente doppioni)
      update public.activities a set start_time = (sl->>'start')::time, end_time = (sl->>'end')::time, season_id = s
       where a.ctid = (select ctid from public.activities b where b.date = d and b.kind = sl->>'kind'
                        and b.start_time is null and b.season_id is null and b.status = 'attiva' limit 1);
      if found then n_adopt := n_adopt + 1;
      elsif not exists (select 1 from public.activities a where a.date = d and a.kind = sl->>'kind'
                      and a.start_time = (sl->>'start')::time) then
        insert into public.activities(date, kind, start_time, end_time, season_id)
        values (d, sl->>'kind', (sl->>'start')::time, (sl->>'end')::time, s);
        n_new := n_new + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('season_id', s, 'created', n_new, 'removed', n_del, 'kept_with_staff', n_kept, 'adopted', n_adopt);
end $$;


revoke all on function public.admin_save_season(uuid,text,date,date,jsonb) from public, anon;
grant execute on function public.admin_save_season(uuid,text,date,date,jsonb) to authenticated;
