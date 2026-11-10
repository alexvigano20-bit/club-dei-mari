-- =====================================================================
-- Archivio PDF privato. Nessun URL pubblico: solo link firmati brevi
-- (60 s) generati per utenti attivi autorizzati.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workout-pdfs', 'workout-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

-- Caricamento: solo gestori allenamenti, solo nella cartella dell'allenamento, solo .pdf
create policy "pdf_upload_managers" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workout-pdfs'
    and private.can_workouts()
    and (storage.foldername(name))[1] = 'workouts'
    and exists (select 1 from public.workouts w where w.id::text = (storage.foldername(name))[2])
    and lower(name) like '%.pdf'
  );

-- Lettura (anche per creare link firmati): gestori sempre; staff attivo
-- solo se l'allenamento è pubblicato e l'originale è stato condiviso
create policy "pdf_read_authorized" on storage.objects for select to authenticated
  using (
    bucket_id = 'workout-pdfs' and (
      private.can_workouts()
      or (private.is_active() and exists (
            select 1 from public.workout_files f join public.workouts w on w.id = f.workout_id
             where f.storage_path = storage.objects.name and w.status = 'pubblicato' and w.share_original))
    )
  );
-- Nessuna policy di UPDATE/DELETE: gli originali sono immutabili dall'app.
