#!/usr/bin/env bash
# Ricrea il database di test locale e applica shim + migrazioni
set -euo pipefail
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists cdm_test" -c "create database cdm_test"
$P -d cdm_test -f "$(dirname "$0")/../tests/supabase_shim.sql"
for f in "$(dirname "$0")"/../supabase/migrations/*.sql; do echo "→ $(basename "$f")"; $P -d cdm_test -f "$f"; done
