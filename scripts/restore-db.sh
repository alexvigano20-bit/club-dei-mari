#!/usr/bin/env bash
# Ripristino su un database NUOVO e vuoto (stesso progetto ricreato o altro provider Postgres).
# Prima: applica le migrazioni di supabase/migrations nell'ordine (o "supabase db push").
# Uso:  DB_URL='postgresql://...' ./scripts/restore-db.sh backup/AAAA-MM-GG
set -euo pipefail
: "${DB_URL:?Imposta DB_URL}"; DIR="${1:?Indica la cartella del backup}"
TABLES="profiles profile_private activities assignments availability_responses replacement_requests attendance_records workouts workout_versions workout_files announcements audit_log"
{
  echo "begin;"
  for t in $TABLES; do echo "alter table public.$t disable trigger user;"; done
  # riferimenti circolari (workouts ↔ versioni, sostituzioni): verificati a fine transazione
  echo "set constraints all deferred;"
  [ -f "$DIR/auth_users.sql" ] && grep -v '^SET\|^SELECT pg_catalog' "$DIR/auth_users.sql"
  grep -v '^SET\|^SELECT pg_catalog' "$DIR/public_data.sql"
  echo "set constraints all immediate;"
  for t in $TABLES; do echo "alter table public.$t enable trigger user;"; done
  echo "select setval(pg_get_serial_sequence('public.audit_log','id'), coalesce((select max(id) from public.audit_log),1));"
  echo "commit;"
} | psql "$DB_URL" -v ON_ERROR_STOP=1 -q
echo "Ripristino dati completato. Ricarica i PDF con: node scripts/restore-storage.mjs $DIR"
