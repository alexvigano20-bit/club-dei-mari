# Proprietà, costi e passaggio di consegne

## Principio: l'app appartiene al club; Alessandro resta come sviluppatore

Proprietario finale di tutto: **info@clubdeimari.com** (gestita da Mario).
Alessandro resta dentro con un ruolo da **sviluppatore**, visibile a Mario e revocabile da Mario in qualsiasi momento, per correggere bug su richiesta. È un accordo di fiducia: nessun accesso nascosto, tutto risulta negli elenchi dei membri.

| Servizio | Oggi (fase di prova) | Dopo il passaggio | Ruolo di Alessandro dopo |
|---|---|---|---|
| Supabase (database, accessi, PDF) | Progetto di **prova** `club-dei-mari-prova` (solo dati finti) sull'account di Alessandro | info@clubdeimari.com crea l'organizzazione «Club dei Mari» e un **nuovo progetto di produzione** (usa la quota gratuita di info@, non quella di Alessandro); le migrazioni del repository vengono applicate lì; il progetto di prova viene poi eliminato | Membro **Developer** dell'organizzazione: può correggere database e funzioni, non può eliminare l'organizzazione né cambiare la fatturazione |
| GitHub (codice e hosting) | Repository `club-dei-mari` sull'account di Alessandro | Repository in un'organizzazione GitHub gratuita del club, Owner info@clubdeimari.com | **Collaboratore con permesso di scrittura** (o *Maintain*) |
| App (ruoli interni) | Alessandro = responsabile di prova | Mario = **Responsabile** | Istruttore (come nella realtà) |

**Cosa serve dalla casella info@** (una sola volta, al passaggio): creare/accettare 2 account (Supabase e GitHub, ognuno chiede di confermare l'email con un clic) e accettare gli inviti. Circa 10 minuti, chi legge info@ insieme ad Alessandro.

**Perché non subito:** ogni servizio, alla registrazione, manda un'email di verifica a quell'indirizzo; senza accesso alla casella non si può aprire l'account. Lavorare ora sugli account di Alessandro e trasferire dopo il collaudo evita di disturbare Mario prima del tempo.

**Indirizzo dell'app:** su GitHub Pages l'indirizzo dipende dal proprietario del repository (oggi `alexvigano20-bit.github.io/club-dei-mari`). Il trasferimento all'organizzazione del club va fatto **prima** che lo staff installi l'app sul telefono, oppure si usa un dominio proprio (vedi sotto), che non cambia mai.

## Abbonamenti: nessuno

| Servizio | Piano | Carta di credito | Cosa succede oltre i limiti |
|---|---|---|---|
| Supabase | Free (DB 500 MB, file 1 GB, banda 5 GB/mese, 50.000 utenti attivi) | Non va inserita | Il servizio viene **limitato** (sola lettura o pausa), senza addebiti. Senza carta non è possibile passare a un piano a pagamento per errore |
| GitHub Pages (hosting) | Free per repository pubblici | Non richiesta | Limiti larghi per un sito statico di poche centinaia di KB |
| GitHub | Free | Non richiesta | Il ping giornaliero usa pochi secondi dei 2.000 minuti/mese gratuiti |
| Email (invio) | Non usata | — | Login con password, nessun servizio email |
| Dominio | Non necessario | — | Vedi sotto |

Per lo staff (una ventina di persone, poche decine di PDF all'anno) l'uso previsto è una piccola frazione dei limiti.

**Regola:** non inserire mai la carta di credito in Supabase o GitHub senza una decisione esplicita. Senza carta nessun addebito è possibile.

## Budget 25–50 €/anno: cosa vale la pena pagare

| Opzione | Costo indicativo | Vantaggio | Consiglio |
|---|---|---|---|
| **Dominio proprio** (es. `staff.clubdeimari.it`) | ~10–20 €/anno, da verificare all'acquisto | L'indirizzo dell'app non dipende dall'hosting: se un giorno si cambia fornitore, i telefoni continuano a funzionare senza reinstallare. Indirizzo più facile da ricordare | **Facoltativo**, l'unica spesa sensata nel budget. Si può aggiungere anche dopo, ma conviene prima di installare l'app su tutti i telefoni |
| Supabase Pro | ~25 $/mese (~300 €/anno) | Niente pausa per inattività, backup automatici | **No**: fuori budget. Il ping giornaliero e i backup con gli script coprono la necessità |
| Servizio email (SMTP) | Gratuito o a pagamento | Recupero password via email | **No**: la password la reimposta Mario dall'app |

Conclusione: **0 €/anno** è sufficiente. Il dominio è l'unica spesa che darebbe un vantaggio reale, cioè la durata e la libertà di cambiare fornitore.

## Fasi

1. **Collaudo di Alessandro** (versione di prova, dati finti). Alessandro prova i tre ruoli da solo, con tre account di prova:
   - responsabile, allenamenti e istruttore;
   - per gli indirizzi bastano varianti della sua email (es. con `+mario`, `+fabio`, `+istr`): l'app non invia email, servono solo come nome utente;
   - si possono aprire insieme dal telefono e dal PC, anche in finestre anonime.

   Le correzioni si fanno qui. **Mario non riceve nulla finché Alessandro non dà l'ok.**
2. **Collaudo con Mario, Fabio e un istruttore**, sempre con dati finti.
3. **Produzione:** i dati di prova vengono cancellati. Mario diventa il responsabile nell'app, Alessandro resta come istruttore e, finché serve, come referente tecnico dell'account del club.
4. **Passaggio di consegne:** quando Mario vuole, segue la checklist qui sotto.

## Checklist del passaggio a Mario (info@clubdeimari.com)

- [ ] Con info@: account Supabase creato (conferma email), 2FA sul telefono di Mario.
- [ ] Supabase: info@ crea l'organizzazione «Club dei Mari» (Free) e il progetto di produzione (regione eu-central-1); invita Alessandro come **Developer** (il ruolo Developer non consuma i 2 progetti gratuiti di Alessandro: il limite conta solo Owner e Administrator).
- [ ] Migrazioni `supabase/migrations/` e funzione `admin-users` applicate al nuovo progetto; `web/js/config.js` aggiornato; primo responsabile creato per Mario (`private.bootstrap_admin`).
- [ ] Progetto di prova eliminato dall'organizzazione di Alessandro.
- [ ] Con info@: account GitHub creato e organizzazione gratuita del club creata; repository trasferito lì (Settings → Transfer); Alessandro collaboratore con scrittura.
- [ ] Aggiornato l'indirizzo dell'app se cambia (prima dell'installazione da parte dello staff).
- [ ] Nell'app Mario è «Responsabile». Alessandro rimane istruttore o viene disattivato, come Mario preferisce.
- [ ] Mario sa fare l'esportazione mensile dei dati (Gestione Club → «Esporta tutti i dati»).
- [ ] Consegnati a Mario lo ZIP del codice, questo documento, `BACKUP_E_MANUTENZIONE.md` e `GUIDA_MARIO.md`.
- [ ] Chi riceve le email di Supabase (avvisi di sospensione o limiti) le legge: arrivano al Gmail del club.

Per la manutenzione tecnica straordinaria (aggiornamenti, ripristino) Mario potrà incaricare chiunque: tutto è documentato e senza componenti proprietari.
