# Genera tests/rls_test_supabase.sql da tests/rls_test.sql: stessi test, eseguibili sul progetto
# Supabase REALE in un'unica transazione che termina con un errore voluto (tutto annullato).
import re, sys
s = open('tests/rls_test.sql').read()
vars_ = dict(re.findall(r"^\\set (\w+) '([^']+)'", s, re.M))
s = re.sub(r"^\\.*$", "", s, flags=re.M)
for k, v in vars_.items(): s = s.replace(f":'{k}'", f"'{v}'")
s = s.replace("select private.bootstrap_admin('mario@test.invalid','Mario');",
"""insert into public.profiles(id, display_name, is_admin, can_manage_workouts) values ('00000000-0000-0000-0000-00000000000a','Mario',true,true);
insert into public.profile_private(id,email) values ('00000000-0000-0000-0000-00000000000a','mario@test.invalid');
update public.profiles set is_admin = false where id <> '00000000-0000-0000-0000-00000000000a';""")
s = s.replace("insert into auth.users(id,email) values", "insert into auth.users(id,email,email_confirmed_at) values")
s = re.sub(r"\('(00000000-0000-0000-0000-0000000000\w\w)','(\w+@test\.invalid)'\)", r"('\1','\2',now())", s)
s = re.sub(r"\('(00000000-0000-0000-0000-00000000000\w)','(\w+@test\.invalid)'\)(?=[,;])", r"('\1','\2',now())", s)
i = s.index("reset role;\n\nselect case when ok")
s = s[:i] + """reset role;
do $$ begin raise exception 'RISULTATI % ok / % falliti || %', (select count(*) filter (where ok) from test.results), (select count(*) filter (where not ok) from test.results),
  coalesce((select string_agg(name || coalesce(' ['||detail||']',''), ' | ') from test.results where not ok), 'nessun fallimento'); end $$;
"""
s = re.sub(r"^--.*\n", "", s, flags=re.M)
s = re.sub(r"\n{2,}", "\n", s)
open('tests/rls_test_supabase.sql', 'w').write(s)
print(len(s))
