#!/usr/bin/env bash
# Controlla la sintassi di tutti i moduli dell'app (come moduli ES) e la coerenza della versione.
# Se fallisce, l'app NON viene pubblicata: un solo errore di sintassi la renderebbe inutilizzabile.
set -e
dir=$(mktemp -d)
fail=0
for f in web/js/*.js web/sw.js; do
  cp "$f" "$dir/m.mjs"
  if ! node --check "$dir/m.mjs" 2>"$dir/err"; then echo "ERRORE DI SINTASSI in $f:"; head -5 "$dir/err"; fail=1; fi
done
node tests/version_test.mjs || fail=1
exit $fail
