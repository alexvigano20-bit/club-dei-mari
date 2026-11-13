// Test end-to-end dell'interfaccia (Chromium, profili iPhone e Android emulati)
// contro l'API simulata + Postgres locale con le stesse regole RLS.
// Prerequisiti: ./scripts/local-db-reset.sh, seed_ui.sql, node tests/mock-supabase.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const APP = 'http://localhost:8080/';
const PDF = process.env.PDF || '/home/claude/dossier/Club_dei_Mari_Handoff/fonti/2026-27_Allenamenti.pdf';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots';
mkdirSync(SHOTS, { recursive: true });
const PW = 'Prova-2026!';
const results = [];
const ok = (cond, name, extra = '') => { results.push({ ok: !!cond, name, extra }); console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch();
const errors = [];
async function device(name, profile) {
  const ctx = await browser.newContext({ ...devices[profile], acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'nota di prova' : undefined));
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; window.__printed = document.getElementById('printArea').innerHTML; }; });
  return { ctx, page, name };
}
async function login(d, email, tourSkip = true) {
  await d.page.goto(APP); await d.page.fill('#email', email); await d.page.fill('#password', PW); await d.page.click('button[type=submit]');
  await d.page.waitForSelector('#greeting:has-text("Ciao")', { timeout: 10000 });
  if (tourSkip && await d.page.isVisible('text=Salta la guida')) await d.page.click('text=Salta la guida');
}
const shot = (d, n) => d.page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const printed = async (d, n) => { await d.page.waitForFunction((k) => window.__prints >= k, n, { timeout: 5000 }); return d.page.evaluate(() => window.__printed || ''); };
// sceglie l'opzione il cui testo inizia con il nome (le etichette ora includono la disponibilità)
const pick = async (loc, name) => { const v = await loc.locator('option').evaluateAll((os, n) => os.find((o) => o.textContent.startsWith(n))?.value, name); return loc.selectOption(v); };
const nav = (d, label) => d.page.click(`.bottomnav button:has-text("${label}")`);

try {
  // ---------- 1. Istruttore su iPhone: login, guida, turni ----------
  const i1 = await device('istruttore1-iphone', 'iPhone 13');
  await i1.page.goto(APP); await shot(i1, '01-login');
  await i1.page.fill('#email', 'istruttore1@prova.invalid'); await i1.page.fill('#password', 'sbagliata1'); await i1.page.click('button[type=submit]');
  await i1.page.waitForSelector('.error'); ok(await i1.page.isVisible('text=Email o password non corretti'), 'Login: password errata rifiutata con messaggio chiaro');
  await i1.page.fill('#password', PW); await i1.page.click('button[type=submit]');
  await i1.page.waitForSelector('.tour'); await shot(i1, '02-guida'); ok(true, 'Guida mostrata al primo accesso');
  ok(await i1.page.isVisible('text=PASSO 1 DI 8'), 'Guida istruttore: 8 passi (niente Pianifica/Gestione/Caricare allenamenti)');
  await i1.page.click('text=Salta la guida'); await i1.page.waitForSelector('.hero'); await shot(i1, '03-home-istruttore');
  ok(!(await i1.page.isVisible('text=Gestione Club')), 'Istruttore: Gestione Club non visibile');
  ok(await i1.page.isVisible('.bottomnav button:has-text("I miei turni")') && await i1.page.isVisible('.bottomnav button:has-text("Comunicazioni")'), 'Quattro tasti fissi in basso');
  await nav(i1, 'I miei turni'); await i1.page.waitForSelector('h2:has-text("I miei turni")');
  const n = await i1.page.locator('.card.shift button:has-text("Ci sono")').count(); ok(n >= 3, 'I miei turni: turni futuri con pulsanti', `${n} turni`);
  await i1.page.locator('.card.shift button:has-text("✓ Ci sono")').first().click(); await i1.page.waitForSelector('text=Hai indicato «Ci sono»');
  ok(true, '«Ci sono» registrato');
  await i1.page.locator('.card.shift button:has-text("Non ci sono")').nth(1).click(); await i1.page.waitForSelector('text=Richiesta di sostituzione inviata');
  ok(true, '«Non ci sono» → richiesta di sostituzione'); await shot(i1, '04-miei-turni');
  await i1.page.click('button:has-text("Stampa / Salva PDF")'); ok((await printed(i1, 1)).includes('<table>'), 'Stampa «I miei turni»');

  // calendario
  await nav(i1, 'Calendario'); await i1.page.waitForSelector('.monthcard.current'); await shot(i1, '05-calendario');
  const mine = i1.page.locator('.monthcard .day.mine').first(); await mine.click(); await i1.page.waitForSelector('#sheet:not(.hidden)');
  ok(await i1.page.isVisible('#sheet >> text=Il tuo turno'), 'Calendario: giorno assegnato mostra «Il tuo turno»'); await shot(i1, '06-giorno-assegnato');
  await i1.page.click('.sheet-close');
  const other = i1.page.locator('.monthcard.current ~ .monthcard .day.has:not(.mine)').first(); await other.click();
  ok(await i1.page.isVisible('#sheet >> text=Non sei assegnato'), 'Calendario: giorno non assegnato senza autoassegnazione');
  ok(await i1.page.locator('#sheet button:has-text("Ci sono")').count() === 0, 'Nessun «Ci sono» su giorni non assegnati');
  await shot(i1, '07-giorno-non-assegnato'); await i1.page.click('.sheet-close');
  await i1.page.click('button:has-text("Stampa / Salva PDF")'); ok((await printed(i1, 2)).includes('monthcard'), 'Stampa calendario');

  // ---------- 2. Mario su Android: sostituzione ----------
  const mario = await device('mario-android', 'Pixel 5');
  await login(mario, 'mario@prova.invalid'); await shot(mario, '08-home-mario');
  ok(await mario.page.isVisible('text=Gestione Club'), 'Mario: Gestione Club visibile');
  await nav(mario, 'Comunicazioni'); await mario.page.waitForSelector('text=SOSTITUZIONE');
  ok(await mario.page.isVisible('text=Istruttore Prova Uno non c\'è'), 'Mario vede la richiesta dell\'istruttore');
  await shot(mario, '09-sostituzione');
  const sel = mario.page.locator('select[id^="rep-"]').first(); await sel.selectOption({ label: 'Istruttore Prova Due' });
  await mario.page.locator('button:has-text("Assegna sostituto")').first().click(); await mario.page.waitForSelector('text=SOSTITUZIONE', { state: 'detached' });
  ok(true, 'Mario assegna il sostituto');

  // assegnazione da calendario
  await nav(mario, 'Calendario'); await mario.page.locator('.monthcard.current ~ .monthcard .day.has').first().click();
  await mario.page.waitForSelector('#sheet >> text=Gestione (solo Mario)');
  const asel = mario.page.locator('#sheet select[id^="as-"]').first(); await pick(asel, 'Fabio (prova)');
  await mario.page.locator('#sheet button:has-text("Assegna")').first().click(); await mario.page.waitForSelector('#sheet >> text=Fabio (prova)');
  ok(true, 'Mario assegna un turno dal calendario'); await shot(mario, '10-mario-giorno'); await mario.page.click('.sheet-close');

  // sincronizzazione sull'altro telefono
  await i1.page.reload(); await nav(i1, 'I miei turni'); await i1.page.waitForSelector('h2:has-text("I miei turni")');
  ok(await i1.page.locator('text=Richiesta di sostituzione inviata').count() === 0, 'Sincronizzazione: il turno sostituito non è più dell\'istruttore');

  // ---------- 3. Fabio: PDF → bozze → revisione → pubblicazione ----------
  const fabio = await device('fabio-iphone', 'iPhone 13');
  await fabio.page.goto(APP); await fabio.page.fill('#email', 'fabio@prova.invalid'); await fabio.page.fill('#password', PW); await fabio.page.click('button[type=submit]');
  await fabio.page.waitForSelector('.tour'); ok(await fabio.page.isVisible('text=PASSO 1 DI 9'), 'Guida Fabio: 9 passi (con «Caricare un allenamento», senza Gestione)');
  await fabio.page.click('text=Salta la guida');
  ok(!(await fabio.page.isVisible('text=Gestione Club')), 'Fabio: niente Gestione Club');
  await nav(fabio, 'Allenamenti'); await fabio.page.waitForSelector('text=Carica PDF'); await shot(fabio, '11-allenamenti-fabio');
  await fabio.page.setInputFiles('#pdfInput', PDF);
  await fabio.page.waitForSelector('text=Ho trovato', { timeout: 30000 });
  const found = await fabio.page.locator('text=tutte le parole e i numeri del PDF sono presenti').count();
  ok(found === 5, 'PDF reale: 5 schede riconosciute con integrità del testo', `${found}/5`); await shot(fabio, '12-pdf-schede');
  // prepara solo l'ultima (Novembre – Settimana 1)
  const boxes = fabio.page.locator('input[data-change="upPick"]'); const c = await boxes.count();
  for (let i = 0; i < c - 1; i++) await boxes.nth(i).uncheck();
  await fabio.page.click('text=Crea le bozze'); await fabio.page.waitForSelector('h3:has-text("Scheda proposta")', { timeout: 15000 });
  await shot(fabio, '13-revisione-scheda');
  ok(await fabio.page.isDisabled('[data-act="wPublish"]'), 'Pubblicazione bloccata con blocchi da verificare');
  while (await fabio.page.locator('button:has-text("Ho verificato questo blocco")').count()) await fabio.page.locator('button:has-text("Ho verificato questo blocco")').first().click();
  // titolo a un blocco senza titolo + correzione (resta tracciata come differenza)
  await fabio.page.locator('.blockedit input[data-change="bTitle"]').nth(2).fill('DYN e recupero in movimento'); await fabio.page.locator('.blockedit input[data-change="bTitle"]').nth(2).blur();
  ok(await fabio.page.isVisible('text=Differenze rispetto al testo del PDF'), 'Differenze rispetto all\'originale evidenziate');
  await fabio.page.click('[data-act="tab"][data-t="originale"]'); await shot(fabio, '14-revisione-originale');
  ok(await fabio.page.isVisible('.source:has-text("Novembre - Settimana 1")'), 'Vista originale affiancata (testo estratto)');
  await fabio.page.click('[data-act="tab"][data-t="scheda"]');
  await fabio.page.click('#saveBtn'); await fabio.page.waitForSelector('text=Bozza salvata');
  await fabio.page.check('#pubCheck'); await fabio.page.click('#pubBtn');
  await fabio.page.waitForSelector('text=SCHEDA APPROVATA'); await shot(fabio, '15-scheda-pubblicata');
  ok(true, 'Fabio approva e pubblica');
  // Il testo scritto in un blocco non si perde se l'app si aggiorna da sola (ogni 5 minuti o al ritorno da un'altra app)
  await fabio.page.click('button:has-text("Tutti gli allenamenti")'); await fabio.page.waitForSelector('h3:has-text("Schede di questa stagione")');
  await fabio.page.locator('[data-act="wRead"]').first().click(); await fabio.page.locator('[data-act="wReview"]').first().click(); await fabio.page.waitForSelector('textarea[data-change="bBody"]');
  const ta = fabio.page.locator('textarea[data-change="bBody"]').first(); await ta.click(); await ta.press('End'); await ta.type(' PROVA-NON-PERDERE');
  await fabio.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await fabio.page.waitForTimeout(1500);
  ok((await fabio.page.locator('textarea[data-change="bBody"]').first().inputValue()).includes('PROVA-NON-PERDERE'), 'Revisione: il testo in scrittura non si perde quando l\'app si aggiorna');
  await fabio.page.goto(APP + '#work'); await fabio.page.reload(); await fabio.page.waitForSelector('text=Modifiche non salvate');
  ok(true, 'Revisione: dopo una ricarica della pagina l\'app propone di riprendere le modifiche');
  await fabio.page.click('text=Riprendi da dove eri rimasto'); await fabio.page.waitForSelector('textarea[data-change="bBody"]');
  ok((await fabio.page.locator('textarea[data-change="bBody"]').first().inputValue()).includes('PROVA-NON-PERDERE'), 'Revisione: modifiche recuperate dopo la ricarica');
  await fabio.page.click('[data-act="wList"]');
  ok(await fabio.page.isVisible('text=Settimana dal'), 'Scheda pubblicata: indica la settimana in cui si usa');
  // stesso PDF ricaricato (con le settimane nuove in fondo): le schede già presenti non vengono riproposte
  await fabio.page.goto(APP + '#work'); await fabio.page.reload(); await fabio.page.waitForSelector('h3:has-text("Schede di questa stagione")');
  await fabio.page.setInputFiles('#pdfInput', PDF); await fabio.page.waitForSelector('text=Ho trovato', { timeout: 30000 });
  ok(await fabio.page.locator('.item:has-text("già nell\'app") input[data-change="upPick"]:not(:checked)').count() === 1, 'PDF ricaricato: scheda già presente riconosciuta e non selezionata');
  // PDF di una stagione passata: archiviazione diretta nello storico, con le settimane in ordine
  const allBoxes = fabio.page.locator('input[data-change="upPick"]'); for (let i = 0; i < await allBoxes.count(); i++) await allBoxes.nth(i).check();
  await fabio.page.fill('#upWeek', '2025-10-15'); await fabio.page.check('#upArchive');
  await fabio.page.click('text=Crea le bozze'); await fabio.page.waitForSelector('#toast:has-text("archiviate nello storico 2025/26")', { timeout: 20000 });
  ok(await fabio.page.isVisible('summary:has-text("Stagione 2025/26 · 5 schede")'), 'Stagione passata archiviata direttamente nello storico');
  await fabio.page.click('summary:has-text("Stagione 2025/26")');
  ok((await fabio.page.locator('.histitem').first().textContent()).includes('13 ott 2025'), 'Storico: settimane assegnate in ordine dal lunedì scelto');

  // ---------- 4. Altro istruttore: legge, stampa, apre il PDF originale ----------
  const i2 = await device('istruttore2-android', 'Pixel 5');
  await i2.page.goto(APP); await i2.page.fill('#email', 'istruttore2@prova.invalid'); await i2.page.fill('#password', PW); await i2.page.click('button[type=submit]');
  await i2.page.waitForSelector('text=Scegli la tua password'); ok(true, 'Primo accesso: cambio password obbligatorio');
  await i2.page.fill('#pw1', 'NuovaPass-2026'); await i2.page.fill('#pw2', 'NuovaPass-2026'); await i2.page.click('button:has-text("Salva password")');
  await i2.page.waitForSelector('.tour'); await i2.page.click('text=Salta la guida');
  await i2.page.waitForSelector('text=QUESTA SETTIMANA'); ok(true, 'Prima pagina: allenamento di questa settimana');
  await nav(i2, 'Allenamenti'); await i2.page.waitForSelector('text=PUBBLICATA');
  ok(!(await i2.page.isVisible('text=Carica PDF')), 'Istruttore: niente caricamento PDF');
  await i2.page.click('button.card:has-text("Settimana 1")'); await i2.page.waitForSelector('text=SCHEDA APPROVATA');
  ok(await i2.page.isVisible('.workblock:has-text("200mt totali")') && await i2.page.isVisible('.workblock:has-text("25mt Snorkel LENTO + 25mt DYN + virata")'), 'Contenuto tecnico identico al PDF, impaginato (totale della serie su una riga)');
  await shot(i2, '16-scheda-istruttore');
  await i2.page.click('button:has-text("Stampa / Salva PDF")'); ok((await printed(i2, 1)).includes('workblock'), 'Stampa scheda allenamento');
  ok(await i2.page.locator('button:has-text("PDF originale")').count() === 0, 'Staff: nessun accesso al PDF originale (decisione Mario)');
  const tokOf = async (d) => JSON.parse(await d.page.evaluate(() => localStorage.getItem('cdm.session.v1'))).access_token;
  const fabioFiles = await (await fetch('http://localhost:54321/rest/v1/rpc/app_workouts', { method: 'POST', headers: { Authorization: `Bearer ${await tokOf(fabio)}`, 'content-type': 'application/json' }, body: '{}' })).json();
  var pdfPath = fabioFiles.find((w) => w.files.length).files[0].storage_path;
  const staffSign = await fetch(`http://localhost:54321/storage/v1/object/sign/workout-pdfs/${pdfPath}`, { method: 'POST', headers: { Authorization: `Bearer ${await tokOf(i2)}`, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
  ok(staffSign.status === 400, 'Staff: link al PDF originale rifiutato anche via API');
  const mgrSign = await fetch(`http://localhost:54321/storage/v1/object/sign/workout-pdfs/${pdfPath}`, { method: 'POST', headers: { Authorization: `Bearer ${await tokOf(fabio)}`, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
  ok(mgrSign.ok, 'Fabio: PDF originale consultabile tramite link firmato');

  // ---------- 4a. Storico allenamenti: scheda della stagione scorsa, ricerca, riuso ----------
  const oldW = '30000000-0000-0000-0000-000000000001', oldV = '30000000-0000-0000-0000-000000000002';
  const sql = (q) => execSync(`psql -h /tmp -p 54329 -U postgres -d ${process.env.PGDATABASE || 'cdm_test'} -q -v ON_ERROR_STOP=1`, { input: q });
  sql(`insert into public.workouts(id,title,status,published_at,created_at) values ('${oldW}','Novembre - Settimana 1 anno scorso','pubblicato', now()-interval '1 year', now()-interval '1 year');
    insert into public.workout_versions(id,workout_id,version_no,title,blocks,approved_at) values ('${oldV}','${oldW}',1,'Novembre - Settimana 1 anno scorso',
      '[{"title":"Statica","body":"Tabelle CO2: 8 x 1 min 30","uncertain":false,"note":""}]'::jsonb, now()-interval '1 year');
    update public.workouts set published_version_id='${oldV}', current_version_id='${oldV}' where id='${oldW}';`);
  await i2.page.reload(); await nav(i2, 'Allenamenti'); await i2.page.waitForSelector('text=Storico allenamenti');
  ok(await i2.page.isVisible('summary:has-text("Stagione")'), 'Storico: stagioni passate raggruppate');
  await i2.page.fill('#wSearch', 'tabelle co2'); await i2.page.waitForSelector('#wResults .histitem');
  ok((await i2.page.locator('#wResults .histitem').count()) === 1, 'Storico: ricerca per parola nel contenuto');
  await shot(i2, '28-storico-allenamenti');
  ok(!(await i2.page.isVisible('text=Idee dagli anni scorsi')), 'Istruttore: niente «Idee» né «Riusa»');
  await fabio.page.goto(APP + '#work'); await fabio.page.reload(); await fabio.page.waitForSelector('text=Idee dagli anni scorsi');
  await shot(fabio, '29-idee-anni-scorsi');
  await fabio.page.locator('.checkline:has-text("anno scorso") [data-act="wReuse"]').click();
  await fabio.page.waitForSelector('#toast:has-text("Nuova bozza creata")');
  await fabio.page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((x) => x.value.includes('Tabelle CO2')), null, { timeout: 10000 }).catch(() => {});
  ok(await fabio.page.locator('textarea').evaluateAll((xs) => xs.some((x) => x.value.includes('Tabelle CO2'))), 'Riusa: nuova bozza con il contenuto della scheda passata');

  // ---------- 4b. Mario pianifica i turni del mese ----------
  await mario.page.goto(APP + '#plan'); await mario.page.waitForSelector('h2:has-text("Pianifica turni")');
  await mario.page.click('[data-act="planMonth"][data-n="1"]'); await mario.page.waitForSelector('text=Assegnazione rapida');
  await mario.page.selectOption('#qPerson', { label: 'Fabio (prova)' });
  await mario.page.click('button:has-text("Assegna per tutto il mese")'); await mario.page.waitForSelector('#toast:has-text("assegnato a")');
  ok(true, 'Pianifica turni: assegnazione rapida a tutti i giorni X del mese', await mario.page.textContent('#toast'));
  const chips = await mario.page.locator('button[data-act="planRemove"]:has-text("Fabio (prova)")').count(); ok(chips >= 2, 'Pianifica turni: nomi visibili su ogni serata', `${chips}`);
  await pick(mario.page.locator('select[data-change="planAdd"]').first(), 'Istruttore Prova Due'); await mario.page.waitForSelector('#toast:has-text("Assegnato")');
  ok(true, 'Pianifica turni: aggiunta con un tocco');
  await shot(mario, '22-pianifica-turni');
  // Stagione: giorni e orari di allenamenti e corsi
  await mario.page.click('[data-act="seasonEdit"]'); await mario.page.waitForSelector('#sheet >> text=Quando ci sono gli allenamenti?');
  await mario.page.locator('.s-allenamento[value="2"]').check(); await mario.page.locator('.s-corso[value="4"]').check();
  await mario.page.fill('#s-corso-start', '19:30'); await mario.page.fill('#s-corso-end', '21:00');
  await shot(mario, '23-stagione');
  await mario.page.click('[data-act="seasonSave"]'); await mario.page.waitForSelector('#toast:has-text("Stagione salvata")');
  ok(await mario.page.isVisible('text=Corsi: gio 19:30–21:00'), 'Stagione creata: riepilogo giorni e orari', await mario.page.textContent('#toast'));
  // tipo istruttore: solo corsi → non compare tra chi può fare allenamenti
  await mario.page.goto(APP + '#admin'); await mario.page.waitForSelector('text=Staff e accessi');
  await mario.page.locator('.checkline:has-text("Istruttore Prova Due") button:has-text("Gestisci")').click();
  await mario.page.locator('#pT').uncheck(); await mario.page.click('[data-act="permSave"]'); await mario.page.waitForSelector('#toast:has-text("Permessi aggiornati")');
  await mario.page.goto(APP + '#plan'); await mario.page.waitForSelector('text=Assegnazione rapida');
  const opts = await mario.page.locator('#qPerson option').allTextContents();
  ok(!opts.includes('Istruttore Prova Due'), 'Istruttore «solo corsi» escluso dagli allenamenti');
  // Disponibilità: l'istruttore dichiara il mese successivo, Mario le vede
  await nav(i2, 'I miei turni'); await i2.page.click('button:has-text("Le mie disponibilità")');
  await i2.page.waitForSelector('h2:has-text("Le mie disponibilità")');
  await i2.page.click('[data-act="availMonth"][data-n="1"]'); await i2.page.waitForSelector('button:has-text("Non ci sono per tutto il mese")');
  await i2.page.click('button:has-text("Non ci sono per tutto il mese")'); await i2.page.waitForSelector('#toast:has-text("non ci sei per tutto il mese")');
  await i2.page.fill('#availNote', 'In viaggio tutto il mese'); await i2.page.click('[data-act="availNoteSave"]'); await i2.page.waitForSelector('#toast:has-text("Nota salvata")');
  await shot(i2, '24-disponibilita');
  ok(await i2.page.locator('[data-act="availToggle"].warn').count() >= 4, 'Disponibilità: serate del mese segnate «non ci sono»');
  await mario.page.goto(APP + '#plan'); await mario.page.reload(); await mario.page.waitForSelector('h2:has-text("Pianifica turni")');
  await mario.page.click('[data-act="planMonth"][data-n="1"]'); await mario.page.waitForSelector('text=Disponibilità dichiarate per');
  await mario.page.click('summary:has-text("Disponibilità dichiarate per")');
  ok(await mario.page.isVisible('text=Nota: In viaggio tutto il mese'), 'Mario: vede disponibilità e nota dell\'istruttore');
  const corsoOpts = await mario.page.locator('select[data-change="planAdd"]').first().locator('option').allTextContents();
  ok(corsoOpts.some((o) => /Istruttore Prova Due — NON disponibile/.test(o)) || corsoOpts.every((o) => !o.includes('Istruttore Prova Due')), 'Menu «aggiungi»: indica chi non è disponibile', corsoOpts.join(' | ').slice(0, 160));
  await shot(mario, '25-pianifica-disponibilita');
  // Registro di funzionamento: nessun pulsante nell'app, nemmeno per il responsabile
  await mario.page.goto(APP + '#admin'); await mario.page.reload(); await mario.page.waitForSelector('text=Dati e sicurezza');
  ok(!(await mario.page.isVisible('text=Controllo funzionamento')), 'Registro di funzionamento: non visibile nell\'app');
  const logged = execSync(`psql -h /tmp -p 54329 -U postgres -d ${process.env.PGDATABASE || 'cdm_test'} -At -c "select count(*) filter (where kind='apertura') || ' ' || count(*) filter (where kind='sezione') from public.usage_events"`).toString().trim().split(' ').map(Number);
  ok(logged[0] >= 2 && logged[1] >= 5, 'Registro di funzionamento: aperture e sezioni registrate nel database', `${logged[0]} aperture, ${logged[1]} sezioni`);
  await mario.page.goto(APP + '#plan'); await mario.page.reload(); await mario.page.waitForSelector('h2:has-text("Pianifica turni")');
  // Promemoria a chi non ha dichiarato: messaggio WhatsApp pronto
  await mario.page.goto(APP + '#plan'); await mario.page.reload(); await mario.page.waitForSelector('h2:has-text("Pianifica turni")');
  await mario.page.click('[data-act="planMonth"][data-n="1"]'); await mario.page.waitForSelector('text=Disponibilità mancanti per');
  const remHref = await mario.page.locator('#remCard a:has-text("WhatsApp")').getAttribute('href');
  const remTxt = decodeURIComponent(remHref.split('text=')[1]);
  ok(/Mancano ancora: .*Istruttore Prova Uno/.test(remTxt) && !remTxt.includes('Istruttore Prova Due'), 'Promemoria: elenca solo chi non ha dichiarato', remTxt.split('\n').pop());
  // Calendario del mese (griglia): un tocco assegna e toglie
  await mario.page.click('[data-act="planMode"][data-m="griglia"]'); await mario.page.waitForSelector('.pgrid');
  const cellSel = '.pgrid tr:has(th:has-text("Istruttore Prova Uno")) button[data-act="gridCell"]:not([data-s])';
  const before = await mario.page.locator('.pgrid tr:has(th:has-text("Istruttore Prova Uno")) button.g-as').count();
  await mario.page.locator(cellSel).first().click(); await mario.page.waitForSelector('#toast:has-text("Assegnato")');
  await mario.page.waitForFunction((b) => document.querySelectorAll('.pgrid tr').length && [...document.querySelectorAll('.pgrid tr')].find((r) => r.textContent.includes('Istruttore Prova Uno'))?.querySelectorAll('button.g-as').length === b + 1, before);
  ok(true, 'Griglia del mese: assegnazione con un tocco');
  ok(await mario.page.locator('.pgrid tr:has(th:has-text("Istruttore Prova Due")) button.g-no').count() >= 1, 'Griglia: mostra chi ha detto «non ci sono»');
  await shot(mario, '26-griglia-mese');
  await mario.page.locator('.pgrid tr:has(th:has-text("Istruttore Prova Uno")) button.g-as').first().click(); await mario.page.waitForSelector('#toast:has-text("Tolto")');
  ok(true, 'Griglia: rimozione con conferma');
  await mario.page.click('[data-act="planMode"][data-m="serate"]');
  // Disponibilità ricorrente: «ci sono tutti i martedì»
  await nav(i1, 'I miei turni'); await i1.page.click('button:has-text("Le mie disponibilità")'); await i1.page.waitForSelector('h2:has-text("Le mie disponibilità")');
  await i1.page.click('[data-act="availMonth"][data-n="1"]'); await i1.page.waitForSelector('summary:has-text("Ripeti ogni settimana")');
  await i1.page.click('summary:has-text("Ripeti ogni settimana")');
  const firstDay = await i1.page.locator('.wkDay').first().getAttribute('value');
  await i1.page.locator('.wkDay').first().check(); await shot(i1, '27-disponibilita-ricorrente');
  await i1.page.click('[data-act="availWeekly"]'); await i1.page.waitForSelector('#toast:has-text("Disponibilità salvate")');
  const okN = await i1.page.locator('[data-act="availToggle"].ok').count(), noN = await i1.page.locator('[data-act="availToggle"].warn').count();
  ok(okN >= 2 && noN >= 2, 'Disponibilità ricorrente: sì nel giorno scelto, no negli altri', `giorno ${firstDay}: ${okN} sì, ${noN} no`);
  await mario.page.goto(APP + '#plan'); await mario.page.reload(); await mario.page.waitForSelector('text=Assegnazione rapida');
  await mario.page.locator('button[data-act="planRemove"]').first().click(); await mario.page.waitForSelector('#toast:has-text("Tolto")'); ok(true, 'Pianifica turni: rimozione con conferma');

  // ---------- 5. Presenze: Mario registra, stampa, esporta CSV ----------
  await mario.page.goto(APP + '#attendance'); await mario.page.waitForSelector('h2:has-text("Registro presenze")');
  await mario.page.waitForSelector('.seg', { timeout: 10000 });
  await mario.page.locator('.checkline:has-text("Istruttore Prova Due") button:has-text("Presente")').first().click();
  await mario.page.waitForSelector('.checkline:has-text("Istruttore Prova Due") button.sel-presente');
  ok(true, 'Presenza registrata senza conferma app'); await shot(mario, '17-registro');
  await mario.page.click('button:has-text("Stampa foglio da spuntare")'); ok((await printed(mario, 1)).includes('class="box"'), 'Stampa registro con caselle');
  const [dl] = await Promise.all([mario.page.waitForEvent('download'), mario.page.click('button:has-text("CSV per Excel")')]);
  const csvText = readFileSync(await dl.path(), 'utf8');
  ok(csvText.charCodeAt(0) === 0xfeff && csvText.includes('"Conferma app";"Presenza verificata"') && csvText.includes('"presente"'), 'CSV Excel: BOM, «;», colonne separate');

  // ---------- 6. Revoca su due dispositivi ----------
  const i1b = await device('istruttore1-secondo-telefono', 'Pixel 5'); await login(i1b, 'istruttore1@prova.invalid');
  const oldSession = await i1b.page.evaluate(() => localStorage.getItem('cdm.session.v1'));
  await mario.page.goto(APP + '#admin'); await mario.page.waitForSelector('text=Staff e accessi');
  await shot(mario, '18-gestione');
  await mario.page.locator('.checkline:has-text("Istruttore Prova Uno") button:has-text("Gestisci")').click();
  await mario.page.click('button:has-text("Disattiva accesso")'); await mario.page.waitForSelector('text=disattivato');
  ok(true, 'Mario disattiva l\'istruttore');
  for (const d of [i1, i1b]) {
    await d.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await d.page.waitForSelector('text=accesso è stato disattivato', { timeout: 10000 }).catch(() => {});
    ok(await d.page.isVisible('text=accesso è stato disattivato'), `Revoca: ${d.name} perde l'accesso`);
    ok(await d.page.evaluate(() => !localStorage.getItem('cdm.cache.v1') && !localStorage.getItem('cdm.session.v1')), `Revoca: ${d.name} dati locali cancellati`);
  }
  await shot(i1, '19-revocato');
  // chiamate dirette con il vecchio token e il vecchio refresh token
  const s = JSON.parse(oldSession);
  const api = (p, body) => fetch('http://localhost:54321' + p, { method: 'POST', headers: { Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const st = await api('/rest/v1/rpc/app_state', { p_from: '2026-01-01', p_to: '2027-12-31' });
  ok(st.body?.me === null && st.body?.activities?.length === 0 && st.body?.staff?.length === 0, 'Revoca: API con vecchio token → nessun dato');
  const wk = await api('/rest/v1/rpc/app_workouts', {}); ok(Array.isArray(wk.body) && wk.body.length === 0, 'Revoca: nessun allenamento via API');
  const path = pdfPath;
  const sign = await api(`/storage/v1/object/sign/workout-pdfs/${path}`, { expiresIn: 60 }); ok(sign.status === 400, 'Revoca: nessun nuovo link al PDF');
  const rf = await fetch('http://localhost:54321/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
  ok(rf.status === 400, 'Revoca: rinnovo sessione rifiutato');
  await i1.page.fill('#email', 'istruttore1@prova.invalid'); await i1.page.fill('#password', PW); await i1.page.click('button[type=submit]');
  await i1.page.waitForSelector('.error'); ok(await i1.page.isVisible('text=disattivato'), 'Revoca: vecchie credenziali rifiutate');

  // ---------- 7. Offline ----------
  await i2.page.goto(APP); await i2.page.waitForSelector('.hero');
  await i2.ctx.setOffline(true); await i2.page.reload().catch(() => {});
  await i2.page.waitForSelector('#banner:not(.hidden)', { timeout: 10000 }).catch(() => {});
  ok(await i2.page.isVisible('text=Sei offline'), 'Offline: app aperta dalla cache con avviso');
  await nav(i2, 'I miei turni'); const b = i2.page.locator('.card.shift button:has-text("Ci sono")').first();
  if (await b.count()) { await b.click(); ok(await i2.page.isVisible('text=la modifica non è stata salvata'), 'Offline: scrittura bloccata con avviso (nessuna perdita silenziosa)'); }
  await shot(i2, '20-offline'); await i2.ctx.setOffline(false);
} catch (e) {
  ok(false, 'Errore durante il test', e.stack.split('\n').slice(0,3).join(' '));
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${SHOTS}/errore-${Math.random().toString(36).slice(2,6)}.png` }).catch(() => {});
} finally {
  ok(errors.length === 0, 'Nessun errore JavaScript in console', errors.slice(0, 5).join(' | '));
  await browser.close();
  const f = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - f} superati, ${f} falliti`);
  process.exit(f ? 1 : 0);
}
