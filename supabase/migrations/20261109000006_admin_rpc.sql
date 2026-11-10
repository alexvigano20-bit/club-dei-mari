-- =====================================================================
-- RPC per attività singole e comunicazioni (tutte le scritture passano
-- da funzioni che verificano i permessi; niente scritture dirette).
-- =====================================================================
revoke insert, update on public.activities, public.announcements from authenticated;

create or replace function public.admin_save_activity(p_id uuid, p_date date, p_kind text, p_title text,
  p_start time, p_end time, p_notes text, p_provisional boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile modifica il calendario');
  perform private.require(p_kind in ('allenamento','corso','altro'), 'Tipo di attività non valido');
  if p_id is null then
    insert into public.activities(date, kind, title, start_time, end_time, notes, provisional)
    values (p_date, p_kind, nullif(trim(p_title),''), p_start, p_end, nullif(trim(p_notes),''), coalesce(p_provisional,false))
    returning id into v;
  else
    update public.activities set date = p_date, kind = p_kind, title = nullif(trim(p_title),''), start_time = p_start,
           end_time = p_end, notes = nullif(trim(p_notes),''), provisional = coalesce(p_provisional,false)
     where id = p_id returning id into v;
    perform private.require(v is not null, 'Attività inesistente');
  end if;
  return v;
end $$;

-- Annulla (es. Natale, piscina chiusa) o ripristina. Nessuna cancellazione definitiva.
create or replace function public.admin_set_activity_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile modifica il calendario');
  perform private.require(p_status in ('attiva','annullata'), 'Stato non valido');
  update public.activities set status = p_status where id = p_id;
  if p_status = 'annullata' then
    update public.replacement_requests rr set status = 'annullata', resolved_at = now(), resolved_by = auth.uid(),
           resolution_note = 'Attività annullata'
      from public.assignments s where s.id = rr.assignment_id and s.activity_id = p_id and rr.status = 'aperta';
  end if;
end $$;

-- Comunicazioni: per ora pubblica solo il responsabile (decisione aperta con Mario)
create or replace function public.post_announcement(p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require(private.is_admin(), 'Solo il responsabile pubblica comunicazioni');
  insert into public.announcements(title, body, created_by) values (trim(p_title), trim(p_body), auth.uid()) returning id into v;
  return v;
end $$;

create or replace function public.archive_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_admin(), 'Solo il responsabile archivia comunicazioni');
  update public.announcements set archived = true where id = p_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_save_activity(uuid,date,text,text,time,time,text,boolean)',
                           'admin_set_activity_status(uuid,text)','post_announcement(text,text)','archive_announcement(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
