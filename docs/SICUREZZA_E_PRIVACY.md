# Sicurezza, permessi e privacy

## Chi può fare cosa (applicato dal database, non solo dall'interfaccia)

| Azione | Istruttore | Fabio (allenamenti) | Mario (responsabile) |
|---|:-:|:-:|:-:|
| Vedere calendario staff, turni, bacheca | ✓ | ✓ | ✓ |
| «Ci sono / Non ci sono» sui **propri** turni assegnati | ✓ | ✓ | ✓ |
| Assegnare o spostare turni | ✗ | ✗ | ✓ |
| Scegliere il sostituto | ✗ | ✗ | ✓ |
| Vedere le risposte degli altri | ✗ | ✗ | ✓ |
| Leggere e stampare le schede **pubblicate** | ✓ | ✓ | ✓ |
| Vedere il **PDF originale** degli allenamenti | ✗ | ✓ | ✓ |
| Caricare PDF, bozze, pubblicare o ritirare schede | ✗ | ✓ | ✓ |
| Registrare ed esportare presenze effettive | solo le proprie in lettura | ✗ | ✓ |
| Avvisi in bacheca | ✗ | ✗ | ✓ |
| Creare, disattivare, riattivare staff; permessi; password | ✗ | ✗ | ✓ |
| Email dello staff, storico modifiche, esportazione completa | ✗ | ✗ | ✓ |

Decisioni di Mario (10/11/2026), imposte dal database: presenze **solo** al responsabile; PDF originale **mai** visibile allo staff (lo ricevono già su WhatsApp); presenze conservate **12 mesi**.

Ogni lettura passa da regole RLS che verificano anche che l'account sia **attivo**. Ogni scrittura passa da funzioni SQL che verificano il ruolo. I test (`tests/rls_test.sql`, 72 controlli) provano anche gli attacchi diretti alle API: autoassegnarsi, darsi privilegi, leggere bozze, caricare file, esportare.

## Revoca di un membro

Quando Mario disattiva un account:
1. **Database:** da quel momento ogni richiesta di quell'account restituisce zero righe (turni, calendario, allenamenti, comunicazioni, presenze, staff) e ogni scrittura è rifiutata. Vale **anche con un token ancora valido**.
2. **Accesso:** l'account viene bloccato (ban), quindi nessun nuovo login e nessun rinnovo della sessione su nessun dispositivo.
3. **PDF originali:** lo staff non vi accede mai; per Fabio/Mario i link firmati scadono entro **60 secondi**.
4. **Telefoni aperti:** l'app ricontrolla quando torna in primo piano, quando torna online e ogni 5 minuti. Mostra «accesso disattivato» e **cancella dal telefono** sessione e dati salvati.
5. **Storico:** turni passati, presenze (per 12 mesi) e registro modifiche restano: la disattivazione non cancella nulla.

**Limiti dichiarati (non eliminabili tecnicamente):**
- un telefono **spento o offline** non riceve la revoca finché non si ricollega: fino ad allora può mostrare gli ultimi dati scaricati (turni propri, calendario, schede pubblicate);
- non si possono cancellare a distanza screenshot, stampe o PDF già salvati;
- dopo un aggiornamento dell'app, il codice dell'interfaccia resta in cache, ma non contiene dati.

## Dati sul telefono

Sul telefono restano solo:
- la sessione di accesso;
- una copia di consultazione offline di calendario, turni e schede pubblicate, cancellata all'uscita o alla revoca.

I dati di gestione (email, storico, registro presenze) e i PDF **non** vengono salvati. Il service worker memorizza solo i file dell'interfaccia.

## Privacy (GDPR): minimizzazione

- Per lo staff si conservano: nome visualizzato, email (visibile solo a Mario), turni, risposte, presenze, modifiche. Niente telefono, indirizzo, data di nascita o dati sanitari.
- Gli atleti non sono nell'app.
- **Da definire con il club**, prima dei dati reali:
  - chi è il titolare del trattamento (il club);
  - una breve informativa allo staff;
  - conservazione presenze: **12 mesi** (decisa da Mario). Ogni notte un job cancella le presenze di attività più vecchie di 12 mesi e le relative voci dello storico; Mario può anche avviare la pulizia a mano. Se servono per la contabilità, esportare prima il CSV.
- Fornitore: Supabase, con dati nella regione UE scelta e DPA disponibile sul sito di Supabase.

## Segreti

- Nell'app c'è solo la chiave **pubblica** (anon/publishable): è prevista per i browser.
- La `service_role` vive solo nella funzione server, che la riceve automaticamente da Supabase, e negli script di backup eseguiti da un computer fidato. Non va mai salvata nel repository.
- La password del database e l'account Supabase vanno protetti con l'autenticazione a due fattori.


## Registro di funzionamento (dal 12/11/2026)
- Tabella `usage_events`: apertura dell'app, sezione aperta, errori tecnici, versione dell'app, tipo di dispositivo/browser (es. «iPhone Chrome»). Nessun contenuto inserito dagli utenti.
- Scrittura solo tramite `log_usage` (utente attivo, max 30 eventi per invio, 600 al giorno). Lettura solo per gli sviluppatori, dal database (pannello Supabase o assistente): `select public.app_usage_report();` per il riepilogo, oppure la tabella `usage_events`. Nessun utente dell'app, nemmeno il responsabile, può leggerlo.
- Cancellazione automatica dopo 90 giorni (pg_cron `cdm-purge-usage`). Indicato nell'informativa per lo staff.
- Le modifiche ai dati restano tracciate separatamente in `audit_log`.

## Aggiornamenti dell'app
- `web/version.json`, `APP_VERSION` in `web/js/monitor.js` e la versione in `web/sw.js` devono coincidere (`tests/version_test.mjs`). Le app rimaste aperte controllano la versione quando tornano in primo piano e ogni 15 minuti: si aggiornano da sole se non si sta scrivendo, altrimenti mostrano «Aggiorna ora».
- `tests/syntax_check.sh` blocca la pubblicazione se un modulo ha un errore di sintassi.
