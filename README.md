# Club dei Mari · App dello staff

PWA (app installabile dal browser) per lo staff del Club dei Mari: turni, sostituzioni, calendario, allenamenti, comunicazioni e registro presenze.

**Stato:** codice completo e testato in locale (database reale Postgres con le stesse regole di sicurezza della produzione). **Non ancora pubblicata.** Vedi `docs/REGISTRO_LAVORI.md`.

## Architettura (semplice di proposito)

| Parte | Tecnologia | Perché |
|---|---|---|
| Interfaccia | HTML + CSS + JavaScript moduli, **nessun framework, nessuna build** | Si apre con qualsiasi editor; niente dipendenze da aggiornare |
| Accesso | Supabase Auth (email + password) | Gratuito, open source; niente servizio email necessario |
| Dati | Postgres (Supabase) con **RLS** + funzioni SQL | Le autorizzazioni sono nel database, non nei pulsanti |
| PDF | Supabase Storage, bucket **privato**, link firmati da 60 s | Nessun URL pubblico permanente |
| Account | 1 funzione server (`admin-users`) | Unica operazione che richiede la chiave segreta |
| Lettura PDF | pdf.js (Apache-2.0) incluso in `web/vendor/` | Nessuna CDN esterna |
| Hosting | Qualsiasi hosting statico HTTPS (Cloudflare Pages / GitHub Pages / Netlify) | Gratuito, intercambiabile |

Nessuna libreria JavaScript di terze parti nell'app (a parte pdf.js caricato solo per Fabio e Mario). Il client parla con le API REST standard di Supabase (`web/js/api.js`, ~150 righe): migrare verso un altro Postgres + PostgREST/GoTrue autogestito non richiede di riscrivere l'interfaccia.

## Struttura

```
web/                    app (da pubblicare così com'è)
  index.html, css/, js/, icons/, manifest.webmanifest, sw.js, vendor/pdfjs/
  js/config.js          ← indirizzo Supabase e chiave PUBBLICA (da compilare)
supabase/
  migrations/*.sql      schema, permessi (RLS), funzioni, storage
  functions/admin-users funzione server per creare/bloccare account
scripts/                reset DB locale, backup e ripristino (dati + PDF)
tests/                  test di sicurezza SQL, test interfaccia, test PDF, emulatore API locale
docs/                   deploy, backup/manutenzione, sicurezza, guide per Mario/Fabio/istruttori
.github/workflows/      test automatici + ping giornaliero anti-sospensione
```

## Comandi utili (sviluppo)

```bash
./scripts/local-db-reset.sh                                   # DB locale con migrazioni (Postgres 15+)
psql ... -d cdm_test -f tests/rls_test.sql                    # 72 test di sicurezza
node tests/parse_test.mjs fonti/2026-27_Allenamenti.pdf v     # estrazione PDF reale
psql ... -d cdm_test -f tests/seed_ui.sql && node tests/mock-supabase.mjs   # app su http://localhost:8080
node tests/ui_test.mjs && node tests/ui_pdf_edge.mjs          # 53 test interfaccia (iPhone/Android emulati)
```

Documenti: [Deploy](docs/DEPLOY.md) · [Backup e manutenzione](docs/BACKUP_E_MANUTENZIONE.md) · [Sicurezza e privacy](docs/SICUREZZA_E_PRIVACY.md) · [Guida Mario](docs/GUIDA_MARIO.md) · [Guida Fabio](docs/GUIDA_FABIO.md) · [Guida istruttori](docs/GUIDA_ISTRUTTORI.md) · [Proprietà e costi](docs/PROPRIETA_E_COSTI.md) · [Registro lavori](docs/REGISTRO_LAVORI.md)
