# Backup, ripristino e manutenzione

## Cosa va salvato

| Cosa | Dove | Come |
|---|---|---|
| Codice e struttura del database | repository (`web/`, `supabase/migrations/`) | Git; tenere una copia ZIP |
| Dati (staff, turni, presenze, allenamenti, storico) | Postgres Supabase | `scripts/backup-db.sh` (completo) **oppure** «Esporta tutti i dati» dall'app (JSON leggibile) |
| PDF originali | Storage Supabase, bucket `workout-pdfs` | `scripts/backup-storage.mjs` |

Il piano Free di Supabase **non offre backup scaricabili**: le copie le facciamo noi.

## Routine consigliata

- **Ogni mese**, e prima di ogni modifica importante: Mario usa «Esporta tutti i dati» dall'app e salva il file in una cartella privata (es. Google Drive personale del club).
- **Ogni 3 mesi**, a cura di chi gestisce la parte tecnica:
  ```bash
  DB_URL='postgresql://postgres.<ref>:<password>@<pooler>:5432/postgres' ./scripts/backup-db.sh
  SUPABASE_URL=https://<ref>.supabase.co SERVICE_ROLE_KEY=<segreta> node scripts/backup-storage.mjs backup/AAAA-MM-GG/pdf
  ```
  Il file `auth_users.sql` contiene gli hash delle password: conservalo cifrato o in un luogo privato.
- **Una volta l'anno**: prova di ripristino su un progetto di prova. Un backup mai provato non è un backup.

## Ripristino (verificato in locale: conteggi identici, sostituzioni e versioni comprese)

1. Crea un progetto nuovo, oppure un Postgres altrove, e applica le migrazioni di `supabase/migrations/`.
2. `DB_URL=... ./scripts/restore-db.sh backup/AAAA-MM-GG`. Lo script carica i dati con i trigger sospesi, quindi lo storico non viene duplicato, e verifica i vincoli alla fine.
3. `SUPABASE_URL=... SERVICE_ROLE_KEY=... node scripts/restore-storage.mjs backup/AAAA-MM-GG/pdf`
4. Aggiorna `web/js/config.js` se l'indirizzo è cambiato e ripubblica.

## Sospensione per inattività (piano Free)

Supabase può sospendere i progetti Free senza attività per 7 giorni (estate!). Le contromisure sono tre:
- il workflow `keepalive.yml` fa un ping ogni giorno;
- Supabase manda un'email di avviso circa una settimana prima della sospensione: chi riceve le email del progetto deve leggerle;
- se il progetto viene sospeso: Dashboard → progetto → **Resume project**. Si può riattivare **entro 90 giorni**; oltre quel limite servono i backup.

## Controlli periodici (10 minuti al mese)

- [ ] Dashboard Supabase → Advisors (Security e Performance): nessun avviso rosso.
- [ ] Usage: database < 500 MB, storage < 1 GB, banda < 5 GB al mese (valori attuali del piano Free; ricontrollarli una volta l'anno sul sito di Supabase).
- [ ] Il workflow keep-alive di GitHub è verde.
- [ ] Mario: le persone che hanno lasciato lo staff sono disattivate.
- [ ] Ultimo export dei dati più recente di 1 mese.

## Aggiornamenti dell'app

1. Modifica i file in `web/` e/o aggiungi una **nuova** migrazione numerata. Non modificare mai quelle già applicate.
2. Esegui i test locali (README).
3. Aumenta `VERSION` in `web/sw.js` e pubblica. I telefoni si aggiornano alla successiva apertura con rete.

## Migrazione ad altro fornitore (se Supabase cambiasse condizioni)

Tutto è standard: Postgres (dump SQL), API REST PostgREST e autenticazione GoTrue (entrambi open source), file PDF normali.

Le alternative possibili sono due:
- Supabase **self-hosted** su un piccolo server: nessuna modifica al codice dell'app;
- un altro Postgres con PostgREST: va adattato solo `web/js/api.js` per login e file.

La tabella dei permessi è in SQL e si porta con sé.

## Passaggio di responsabilità

- **Nell'app:** Mario apre «Gestisci» sul nuovo responsabile e attiva «Responsabile». Deve sempre restare almeno un responsabile attivo: il database lo impone.
- **Su Supabase:** aggiungi il nuovo referente come Owner dell'organizzazione (Organization → Team). Solo dopo rimuovi il precedente.
- Non esistono accessi nascosti o «di servizio» nell'app.


## Strumenti di ripristino per gli sviluppatori (dal 12/11/2026)
Schema `dev`, usabile solo dal database (assistente o SQL Editor di Supabase), mai dall'app.
- Chi ha fatto cosa: `select * from dev.changes(since => now() - interval '2 days', who => 'Mario');`
- Fotografie: una automatica ogni notte alle 3:50 (ne restano 30), più quelle manuali: `select dev.take_snapshot('prima di ...');` — elenco: `select id, at, label from dev.snapshots order by at desc;`
- Ripristino da fotografia, totale o per gruppi (stagione, calendario, turni, presenze, disponibilita, allenamenti, bacheca, staff, tutto). Prima la prova, poi quello vero:
  `select * from dev.restore(<id>, array['turni']);` poi `select * from dev.restore(<id>, array['turni'], dry_run => false);`
- Annullare le azioni di una persona da un certo momento: `select * from dev.undo('Mario', since => '2026-11-20 21:00+01', groups => array['turni']);` (prova) e poi con `dry_run => false`. Le righe modificate dopo da altre persone vengono saltate e segnalate.
- Ogni operazione vera scatta prima una fotografia di sicurezza (si torna indietro con `dev.restore` su quella), lavora in una sola transazione e annulla tutto se resterebbero collegamenti rotti. I ripristini compaiono nel registro modifiche come «Ripristino dati (sviluppatori)».
- Lo staff non viene mai creato o cancellato dai ripristini (solo nomi, ruoli e stato attivo). I PDF originali non vengono toccati.

## Avvio sicuro
`web/js/boot.js`: se l'app non parte entro 10 secondi mostra «L'app non si è avviata» con un pulsante che svuota la memoria dell'app sul telefono e la ricarica. `tests/syntax_check.sh` blocca la pubblicazione se il codice ha errori di sintassi.
