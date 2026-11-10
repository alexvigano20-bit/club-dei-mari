# Pubblicazione (deploy) passo per passo

Tempo stimato: 30–45 minuti la prima volta. Costo: 0 € (piano Free di Supabase + hosting statico gratuito).

> Ordine: 1) versione di prova collaudata **da Alessandro da solo** (tre account di prova); 2) collaudo con Mario, Fabio e un istruttore; 3) dati reali. Nella versione di prova il primo responsabile è Alessandro.

## 0. Account del club

Proprietario finale: info@clubdeimari.com. In fase di prova si lavora sugli account di Alessandro e si trasferisce dopo il collaudo: vedi `PROPRIETA_E_COSTI.md`. **Non inserire carte di credito.**

## 1. Progetto Supabase

1. Su supabase.com crea (o scegli) un'organizzazione **dedicata al club**. Così in futuro la potrai trasferire a Mario o aggiungerlo come secondo proprietario. Il piano Free consente al massimo **2 progetti attivi** per persona, contando tutte le organizzazioni.
2. Crea un nuovo progetto nella regione **eu-central-1 (Francoforte)** o **eu-west**, scegli una password del database robusta e conservala.
3. **Authentication → Sign In / Providers → Email**:
   - **Disattiva «Allow new users to sign up»**. È obbligatorio: gli account li crea solo Mario dall'app.
   - Minimum password length: 8.
4. Proteggi l'account Supabase del proprietario con l'autenticazione a due fattori (MFA).

## 2. Database

Applica in ordine i file di `supabase/migrations/` usando uno di questi metodi:
- l'editor SQL della dashboard, incollando un file alla volta in ordine numerico;
- oppure `supabase db push` con la CLI.

Il file `..._storage.sql` crea il bucket privato `workout-pdfs`, con un limite di 10 MB e solo file PDF.

Poi esegui **Advisors → Security**: non devono comparire tabelle senza RLS.

## 3. Funzione server `admin-users`

Con la CLI: `supabase functions deploy admin-users`, lasciando attiva la verifica JWT. In alternativa, dalla dashboard: Edge Functions → Deploy new function, incollando `supabase/functions/admin-users/index.ts`.

Non serve impostare segreti: `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` sono forniti automaticamente.

## 4. Primo responsabile (Mario)

1. **Authentication → Users → Add user**: email di Mario, una password temporanea, «Auto confirm» attivo.
2. Nell'editor SQL:
   ```sql
   select private.bootstrap_admin('email.di.mario@esempio.it', 'Mario');
   ```
   La funzione funziona solo se non esiste ancora un responsabile e non è richiamabile dall'app.
3. Da quel momento Mario crea tutti gli altri accessi dall'app (Gestione Club → Staff e accessi).

## 5. Configura e pubblica l'app

1. In `web/js/config.js` inserisci:
   - `supabaseUrl: 'https://<ref>.supabase.co'`
   - `anonKey`: la chiave **publishable/anon**, che è pubblica per definizione. **Mai** la `service_role`.
   - `environment: 'prova'` oppure `'produzione'`.
2. In `web/index.html`, nella riga `Content-Security-Policy`, puoi sostituire `https://*.supabase.co` con l'indirizzo esatto del progetto e togliere le voci `localhost`.
3. Aumenta `VERSION` in `web/sw.js` a ogni nuova pubblicazione, così i telefoni scaricano l'aggiornamento.
4. Pubblica la cartella `web/` su un hosting statico HTTPS:

| Hosting | Come | Note |
|---|---|---|
| **GitHub Pages** (in uso) | Workflow `.github/workflows/pages.yml`: pubblica `web/` a ogni modifica | Repository pubblico: nel codice non ci sono segreti |
| Cloudflare Pages | Collega il repository, imposta la directory di output `web`, nessun comando di build | Banda illimitata; repository privato ammesso |
| GitHub Pages | Repository **pubblico** (sul piano gratuito) e pubblicazione della cartella `web` tramite Action | Il codice è pubblico; nessun segreto è presente nel codice |
| Netlify | Trascina la cartella `web` su app.netlify.com/drop, oppure collega il repository | Piano gratuito con limiti di banda/crediti mensili |

5. In Supabase, **Authentication → URL Configuration → Site URL**: inserisci l'indirizzo HTTPS dell'app.

## 6. Ping anti-sospensione e test automatici

Nel repository GitHub, aggiungi in Settings → Secrets i valori `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Il workflow `keepalive.yml` interroga il database ogni giorno. Il workflow `tests.yml` riesegue i test di sicurezza a ogni modifica.

## 7. Collaudo obbligatorio prima di dichiarare l'app pronta

Su **telefoni reali**, almeno un Android con Chrome e un iPhone con Safari, con account separati:

- [ ] Installazione: su Android «Installa app», su iPhone Condividi → «Aggiungi alla schermata Home». L'app si apre a schermo intero.
- [ ] Mario crea un istruttore, gli consegna la password temporanea, l'istruttore entra e la cambia.
- [ ] Mario assegna un turno; l'istruttore lo vede dopo l'aggiornamento e risponde «Ci sono».
- [ ] L'istruttore risponde «Non ci sono»; Mario vede la richiesta, assegna il sostituto e il sostituto vede il turno.
- [ ] Fabio carica un PDF reale, rivede la scheda, la pubblica; l'istruttore la legge, la stampa e la salva in PDF (anche su iPhone).
- [ ] Mario stampa il registro, registra una presenza di chi non ha confermato, esporta il CSV e lo apre in Excel.
- [ ] **Revoca:** istruttore connesso su due telefoni; Mario lo disattiva; su entrambi, alla riapertura o entro 5 minuti, compare «accesso disattivato» e nessun dato è più visibile. Le vecchie credenziali vengono rifiutate.
- [ ] Modalità aereo: l'app si apre con l'avviso offline e le modifiche sono bloccate con un messaggio.
