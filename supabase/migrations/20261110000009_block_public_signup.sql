-- Gli account li crea solo il responsabile (funzione admin-users, email già confermata).
-- Una registrazione "fai da te" dall'API pubblica arriva senza conferma: viene rifiutata.
-- Richiede che in Authentication → Sign In / Providers → Email «Confirm email» resti ATTIVO (predefinito).
-- Consigliato comunque disattivare «Allow new users to sign up».
create or replace function private.block_public_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null and coalesce(new.is_anonymous, false) = false then
    raise exception 'Registrazione non consentita: gli accessi li crea il responsabile del club';
  end if;
  if coalesce(new.is_anonymous, false) then
    raise exception 'Accesso anonimo non consentito';
  end if;
  return new;
end $$;
create trigger block_public_signup before insert on auth.users
  for each row execute function private.block_public_signup();
