-- =====================================================================
-- Allenamento della settimana: ogni scheda vale per una settimana
-- (dal lunedì), uguale per tutte le serate di quella settimana.
-- Serve per mostrare «l'allenamento di questa settimana» e per ritrovare
-- negli anni la scheda dello stesso periodo della stagione.
-- =====================================================================

alter table public.workouts add column if not exists week_of date
  check (week_of is null or extract(isodow from week_of) = 1);
create index if not exists workouts_week_of_idx on public.workouts(week_of);

-- Solo Fabio e Mario; null = nessuna settimana indicata
create or replace function public.set_workout_week(p_workout uuid, p_week date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_workouts(), 'Solo Fabio e Mario possono indicare la settimana');
  perform private.require(p_week is null or extract(isodow from p_week) = 1, 'La settimana deve iniziare di lunedì');
  update public.workouts set week_of = p_week, updated_at = now() where id = p_workout;
  perform private.require(found, 'Allenamento inesistente');
end $$;

create or replace function public.app_workouts() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'title',w.title,'status',w.status,'share_original',w.share_original,
      'updated_at',w.updated_at,'published_at',w.published_at,'week_of',w.week_of,
      'published_by',(select display_name from public.profiles where id = w.published_by),
      'current_version_id',w.current_version_id,'published_version_id',w.published_version_id,
      'has_unpublished_changes', w.current_version_id is distinct from w.published_version_id,
      'published', (select jsonb_build_object('id',v.id,'version_no',v.version_no,'title',v.title,'summary',v.summary,'blocks',v.blocks)
                    from public.workout_versions v where v.id = w.published_version_id),
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'storage_path',f.storage_path,'size_bytes',f.size_bytes)),'[]')
                from public.workout_files f where f.workout_id = w.id)
    ) order by coalesce(w.week_of, w.published_at::date, w.updated_at::date) desc, w.title),'[]')
  from public.workouts w
$$;

do $$ declare f text; begin
  foreach f in array array['set_workout_week(uuid,date)','app_workouts()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
