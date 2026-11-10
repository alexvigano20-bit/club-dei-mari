#!/usr/bin/env bash
# Copia di sicurezza dei DATI del database (schema = migrazioni nel repository).
# Uso:  DB_URL='postgresql://postgres.<ref>:<password>@aws-0-eu-...pooler.supabase.com:5432/postgres' ./scripts/backup-db.sh
# Produce: backup/AAAA-MM-GG/{auth_users.sql,public_data.sql}. Il file auth_users.sql contiene
# gli hash delle password: conservalo in un luogo privato (non nel repository).
set -euo pipefail
: "${DB_URL:?Imposta DB_URL (Supabase → Connect → Session pooler)}"
OUT="${OUT:-backup/$(date +%F)}"; mkdir -p "$OUT"
pg_dump "$DB_URL" --data-only --no-owner --no-privileges --table=auth.users --column-inserts -f "$OUT/auth_users.sql"
pg_dump "$DB_URL" --data-only --no-owner --no-privileges --schema=public --column-inserts -f "$OUT/public_data.sql"
pg_dump "$DB_URL" --data-only --no-owner --no-privileges --table=storage.buckets --table=storage.objects --column-inserts -f "$OUT/storage_meta.sql"
echo "Backup dati salvato in $OUT. Per i PDF esegui anche: node scripts/backup-storage.mjs"
