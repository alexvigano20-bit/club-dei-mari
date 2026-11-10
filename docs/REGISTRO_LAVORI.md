# Registro lavori — aggiornato al 10 novembre 2026

Legenda: ✅ completato e testato · 🧪 completato e testato **solo in locale** · ⏳ in corso · ⛔ bloccato (serve una tua decisione o autorizzazione)

## Stato per area

| Area | Stato | Note |
|---|---|---|
| Audit di dossier, demo V2/V3/V4, PWA V1 e PDF | ✅ | Lacune e dati dimostrativi elencati sotto |
| Schema DB, RLS, funzioni, audit, storage privato | 🧪 | 7 migrazioni; **72/72 test di sicurezza** su Postgres 16 |
| Decisioni di Mario del 10/11 (presenze solo Mario, PDF originale mai allo staff, presenze 12 mesi, bacheca) | 🧪 | Imposte dal database, non solo dall'interfaccia |
| «Pianifica turni» per Mario (mese in elenco, aggiunta con un tocco, «a tutti i mercoledì») | 🧪 | |
| Funzione server account (crea, password, blocca) | 🧪 | Logica verificata tramite l'emulatore; il deploy reale è da fare |
| Login, cambio password obbligatorio, sessioni | 🧪 | |
| I miei turni, «Ci sono / Non ci sono», sostituzioni | 🧪 | |
| Calendario verticale, giorno selezionabile, gestione dal giorno (Mario) | 🧪 | |
| Allenamenti: PDF → schede → revisione → versioni → pubblicazione | 🧪 | PDF reale: 5 schede, **integrità 5/5** (nessuna parola o numero perso o aggiunto) |
| PDF scansionato / file non PDF | 🧪 | Messaggio chiaro, nessuna estrazione finta |
| Registro presenze, stampa a caselle, CSV Excel | 🧪 | La presenza su date future è bloccata dal database |
| Stampa / Salva PDF: turni, calendario, schede, registro | 🧪 | Verificata la generazione; **la stampa reale su iPhone è da provare** |
| Revoca su due dispositivi + vecchio token + refresh + link PDF + login | 🧪 | Tutto bloccato; dati locali cancellati |
| Offline: apertura dalla cache, scritture bloccate con avviso | 🧪 | |
| Backup e ripristino database | 🧪 | Ripristino completo con conteggi identici |
| Backup e ripristino PDF | ⏳ | Script pronti; servono storage reale per il test |
| Guide Mario, Fabio, istruttori; deploy; manutenzione; sicurezza | ✅ | `docs/` |
| Progetto Supabase reale (prova) | ⛔ | Lo fai domani da PC (organizzazione dedicata) |
| Hosting HTTPS e installazione PWA su telefoni reali | ⛔ | Domani da PC |
| Collaudo di Alessandro (da solo, 3 account di prova) | ⛔ | Primo passo dopo la pubblicazione di prova |
| Collaudo con Mario, Fabio e un istruttore su telefoni diversi | ⛔ | Solo dopo l'ok di Alessandro |
| Proprietà trasferibile e costi | ✅ | Account del club dedicato, 0 €/anno; vedi `PROPRIETA_E_COSTI.md` |
| Dati reali (staff) | ⛔ | Dopo il collaudo |
| Turni 2026-27 | — | Decisione: li inserisce Mario dall'app con «Pianifica turni»; nessuna importazione dal PDF |

**Totale test automatici: 72 (database) + 50 (interfaccia, iPhone 13 e Pixel 5 emulati) + 3 (casi limite PDF) + 1 (estrazione PDF reale) + ripristino backup. Tutti superati.**

L'emulatore locale (`tests/mock-supabase.mjs`) riproduce le API usate dall'app sopra lo **stesso database e le stesse regole**. Non sostituisce il collaudo su Supabase reale e su telefoni veri.

## Difetti della demo V4 corretti nella nuova versione
- La data «oggi» era fissa (9/11/2026) e il calendario partiva sempre da novembre 2026: ora usa la data reale.
- «Disattiva» cancellava il nome dall'elenco: ora disattiva l'account e conserva lo storico.
- Classe CSS `.notice` mancante; un nome con apostrofo (es. «D'Angelo») rompeva i pulsanti «Rimuovi»/«Disattiva», perché l'escape non copriva l'apostrofo; il PDF originale restava in un URL temporaneo che spariva.
- I permessi erano solo nascosti nell'interfaccia: ora sono applicati dal database.
- Il service worker della PWA V1 metteva in cache tutto: ora salva solo l'interfaccia.

## Dati dimostrativi della V4, NON importati
- Turni ed elenco staff di esempio della demo: non sono dati ufficiali.

## Turni Staff 2026-27 (PDF)
Non importati: li inserisce Mario dall'app («Pianifica turni»). Il PDF presentava colonne con giorni della settimana non coerenti con le date e mesi da febbraio vuoti.

## Difetti trovati nel collaudo
- 10/11: il blocco delle registrazioni pubbliche (trigger) impediva a Mario di creare account. Causa: Supabase inserisce l'utente prima di confermarlo. Rimosso il trigger; resta la protezione RLS (un account senza profilo non vede nulla). I test locali non lo rilevavano perché l'emulatore crea gli utenti già confermati.

## Limiti residui dichiarati
- Nessun OCR per i PDF scansionati: si trascrivono guardando l'originale. Tesseract potrebbe essere aggiunto in seguito, ma non in modo affidabile per schede tecniche.
- Nessuna notifica push: andrebbero concordate e testate su iPhone (iOS 16.4+ solo con app installata).
- La revoca non raggiunge un telefono spento o offline finché non si ricollega, e non cancella screenshot o file già scaricati.
- Gratuità: dipende dalle condizioni attuali dei piani Free di Supabase e dell'hosting, che non sono garantite per sempre. Codice e dati sono esportabili per cambiare fornitore.
- La sospensione per inattività di Supabase Free è mitigata dal ping giornaliero, ma resta un rischio da sorvegliare (email di avviso).

## Decisioni prese da Mario (10/11/2026)
1. Presenze effettive: **solo Mario** (anche il database lo impone).
2. Comunicazioni: **bacheca** di avvisi fissi, solo Mario pubblica; la comunicazione quotidiana resta su WhatsApp.
3. PDF originale degli allenamenti: **mai visibile allo staff** (lo ricevono su WhatsApp); resta archiviato per Fabio e Mario.
4. Presenze conservate **12 mesi**, poi cancellate automaticamente.
5. Turni: **li inserisce Mario** dall'app, con la pagina «Pianifica turni».

## Ancora aperto
- Logo e colori ufficiali del club (ora palette «mare» della V4, senza logo).
- Informativa privacy allo staff (testo breve da preparare con il club).
