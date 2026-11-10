-- Il blocco delle registrazioni via trigger impediva anche gli account creati dal responsabile:
-- Supabase Auth inserisce l'utente prima di segnarlo come confermato. Rimosso.
-- Protezione equivalente: un account senza profilo staff non vede e non può fare nulla (RLS);
-- in più si consiglia di disattivare «Allow new users to sign up» nella dashboard di Supabase.
drop trigger if exists block_public_signup on auth.users;
drop function if exists private.block_public_signup();
