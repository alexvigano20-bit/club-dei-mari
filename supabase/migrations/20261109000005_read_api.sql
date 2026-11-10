-- =====================================================================
-- API di lettura per l'app. SECURITY INVOKER: ogni riga passa dalle
-- policy RLS dell'utente che chiama (un utente disattivato riceve vuoto).
-- =====================================================================

-- Tutto ciò che serve alle quattro sezioni, in una sola chiamata
create or replace function public.app_state(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'me', public.whoami(),
    'server_time', now(),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'active',p.active,
                 'is_admin',p.is_admin,'can_manage_workouts',p.can_manage_workouts,'can_manage_attendance',p.can_manage_attendance)
                 order by p.display_name),'[]') from public.profiles p),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id',a.id,'date',a.date,'kind',a.kind,'title',a.title,'start_time',a.start_time,'end_time',a.end_time,
                 'notes',a.notes,'status',a.status,'provisional',a.provisional,
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

-- Elenco allenamenti: lo staff vede i pubblicati (con contenuto approvato);
-- Fabio e Mario vedono anche bozze e ritirati.
create or replace function public.app_workouts() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'title',w.title,'status',w.status,'share_original',w.share_original,
      'updated_at',w.updated_at,'published_at',w.published_at,
      'published_by',(select display_name from public.profiles where id = w.published_by),
      'current_version_id',w.current_version_id,'published_version_id',w.published_version_id,
      'has_unpublished_changes', w.current_version_id is distinct from w.published_version_id,
      'published', (select jsonb_build_object('id',v.id,'version_no',v.version_no,'title',v.title,'summary',v.summary,'blocks',v.blocks)
                    from public.workout_versions v where v.id = w.published_version_id),
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'storage_path',f.storage_path,'size_bytes',f.size_bytes)),'[]')
                from public.workout_files f where f.workout_id = w.id)
    ) order by coalesce(w.published_at, w.updated_at) desc),'[]')
  from public.workouts w
$$;

-- Dettaglio per la revisione (solo gestori: per gli altri RLS restituisce poco o nulla)
create or replace function public.app_workout_detail(p_workout uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'workout', (select to_jsonb(w) from public.workouts w where w.id = p_workout),
    'current', (select to_jsonb(v) from public.workout_versions v join public.workouts w on w.current_version_id = v.id where w.id = p_workout),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version_no',v.version_no,'title',v.title,'created_at',v.created_at,
                  'created_by',(select display_name from public.profiles where id = v.created_by),'approved_at',v.approved_at)
                  order by v.version_no desc),'[]') from public.workout_versions v where v.workout_id = p_workout),
    'files', (select coalesce(jsonb_agg(to_jsonb(f)),'[]') from public.workout_files f where f.workout_id = p_workout)
  )
$$;

create or replace function public.app_workout_version(p_version uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select to_jsonb(v) from public.workout_versions v where v.id = p_version
$$;

-- Dati riservati al responsabile: email e ultime modifiche
create or replace function public.app_admin() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'emails', (select coalesce(jsonb_object_agg(id, email),'{}') from public.profile_private),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at',l.at,'actor',(select display_name from public.profiles where id = l.actor),
                'table_name',l.table_name,'action',l.action,'old',l.old_data,'new',l.new_data) order by l.at desc),'[]')
              from (select * from public.audit_log order by at desc limit 150) l)
  )
$$;

do $$ declare f text; begin
  foreach f in array array['app_state(date,date)','app_workouts()','app_workout_detail(uuid)','app_workout_version(uuid)','app_admin()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
