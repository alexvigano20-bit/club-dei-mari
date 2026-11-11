// Club dei Mari · Allenamenti: consultazione per tutti; caricamento PDF,
// revisione affiancata, versioni e pubblicazione per Fabio e Mario.
import { CONFIG } from './config.js';
import { rpc, uploadPdf, signedUrl } from './api.js';
import { $, esc, S, R, A, act, toast, loadState, canWorkouts, dt, printHtml, printHeader, download, todayISO, closeSheet } from './core.js';
import { parseWorkouts, linesFromTextContent, integrity } from './workout-parse.js';

const MAX_PDF = 10 * 1024 * 1024;
const W = { mode: 'list', id: null, detail: null, edit: null, dirty: false, tab: 'scheda', upload: null };

const editKey = (id) => `cdm.edit.${id}`;
const keepLocal = () => { try { if (W.edit && W.id) localStorage.setItem(editKey(W.id), JSON.stringify(W.edit)); } catch {} };
const dropLocal = (id) => { try { localStorage.removeItem(editKey(id)); } catch {} };
window.addEventListener('beforeunload', (e) => { if (W.dirty) { e.preventDefault(); e.returnValue = ''; } });

export function renderWork(main) {
  if (!canWorkouts() && ['review', 'upload'].includes(W.mode)) W.mode = 'list';
  ({ list: listView, read: readView, review: reviewView, upload: uploadView })[W.mode](main);
}

const blocksHtml = (v) => `${v.summary ? `<p class="summary">${esc(v.summary)}</p>` : ''}${(v.blocks || []).map((b) =>
  `<div class="workblock">${b.title ? `<b>${esc(b.title)}</b>` : ''}${b.body ? `<div class="body">${esc(b.body)}</div>` : ''}</div>`).join('')}`;

// ---------------- ELENCO ----------------
// Stagione sportiva da settembre ad agosto: «2026/27»
export const seasonOf = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const s = m >= 9 ? y : y - 1; return `${s}/${String(s + 1).slice(2)}`; };
// Settimane: ogni scheda vale dal lunedì alla domenica
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const mondayOf = (iso) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() || 7) - 1)); return isoLocal(d); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoLocal(d); };
const dm = (iso) => new Date(iso + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
export const weekLabel = (iso) => `settimana dal ${dm(iso)} al ${dm(addDays(iso, 6))}`;
const normT = (t) => (t || '').toLowerCase().replace(/[\u2013\u2014-]+/g, ' ').replace(/\s+/g, ' ').trim();
// Schede pubblicate per la settimana in corso (di solito una)
export const thisWeekWorkouts = () => { const m = mondayOf(todayISO()); return (S.workouts || []).filter((w) => w.status === 'pubblicato' && w.published && w.week_of === m); };
// Scheda pubblicata per la settimana di una data (per il giorno nel calendario e per i turni)
export const workoutForDate = (iso) => { const m = mondayOf(iso); return (S.workouts || []).find((w) => w.status === 'pubblicato' && w.published && w.week_of === m); };
export const workoutLinkHtml = (a) => { if (a.kind !== 'allenamento' || a.status !== 'attiva') return ''; const w = workoutForDate(a.date);
  return w ? `<button class="alt sm" style="margin:6px 0" data-act="wOpen" data-id="${w.id}">Allenamento della settimana: ${esc(w.published.title)}</button>` : ''; };
A.wOpen = (el) => { closeSheet(); W.mode = 'read'; W.id = el.dataset.id; A.go({ dataset: { view: 'work' } }); window.scrollTo(0, 0); };
const dayY = (iso) => new Date(iso + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
const pubDate = (w) => w.week_of || (w.published_at || w.updated_at || '').slice(0, 10);
// giorno dell'anno, per trovare le schede «di questo periodo» negli anni passati
const doy = (iso) => { const d = new Date(iso.slice(0, 10) + 'T12:00'); return Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 864e5); };
const nearInYear = (iso, today, before = 7, after = 28) => { const x = (doy(iso) - doy(today) + 365) % 365; return x <= after || x >= 365 - before; };
const plain = (w) => `${w.published?.title || w.title} ${w.published?.summary || ''} ${(w.published?.blocks || []).map((b) => `${b.title} ${b.body}`).join(' ')}`.toLowerCase();
const pubCard = (w, old) => `<button class="card" style="width:100%;text-align:left;display:block;color:inherit;background:#fff" data-act="wRead" data-id="${w.id}">
    <span class="pill ${old ? 'grey' : 'green'}">${old ? 'STORICO ' + seasonOf(pubDate(w)) : 'PUBBLICATA'}</span>${!old && w.week_of === mondayOf(todayISO()) ? ' <span class="pill gold">QUESTA SETTIMANA</span>' : ''}${w.has_unpublished_changes && canWorkouts() ? ' <span class="pill gold">modifiche in bozza</span>' : ''}
    <h3>${esc(w.published?.title || w.title)}</h3>
    ${w.published?.summary ? `<p class="small">${esc(w.published.summary.split('\n').slice(-2).join(' · '))}</p>` : ''}
    <p class="small">${w.week_of ? `<b>${esc(weekLabel(w.week_of))}</b> · ` : ''}Pubblicata ${esc(dt(w.published_at))}${w.published_by ? ' da ' + esc(w.published_by) : ''}</p></button>`;
const histItem = (w) => `<button class="histitem" data-act="wRead" data-id="${w.id}" data-text="${esc(plain(w))}"><b>${esc(w.published?.title || w.title)}</b><span>${esc(dayY(pubDate(w)))}</span></button>`;

function listView(main) {
  const all = S.workouts || [];
  const today = todayISO(), cur = seasonOf(today);
  const pubAll = all.filter((w) => w.status === 'pubblicato' && w.published);
  const pub = pubAll.filter((w) => seasonOf(pubDate(w)) === cur).sort((x, y) => pubDate(y).localeCompare(pubDate(x)));
  const old = pubAll.filter((w) => seasonOf(pubDate(w)) !== cur);
  const drafts = all.filter((w) => w.status !== 'pubblicato');
  const ideas = canWorkouts() ? old.filter((w) => nearInYear(pubDate(w), today)).sort((x, y) => pubDate(y).localeCompare(pubDate(x))).slice(0, 8) : [];
  const seasons = [...new Set(old.map((w) => seasonOf(pubDate(w))))].sort().reverse();
  main.innerHTML = `<h2>Allenamenti</h2>
    ${canWorkouts() ? `<div class="card soft"><span class="pill">SOLO FABIO E MARIO</span>
      <h3>Carica il PDF dell'allenamento</h3>
      <p class="muted">Continua a scrivere come preferisci. L'app legge il PDF, propone la scheda e tu la confronti con l'originale. Nulla viene pubblicato senza la tua approvazione.</p>
      <label class="btn" for="pdfInput" style="width:100%;font-size:18px">Carica PDF</label>
      <input id="pdfInput" type="file" accept="application/pdf,.pdf" class="hidden" data-change="pdfPicked">
      <button class="ghost" style="width:100%" data-act="newBlank">oppure crea una scheda scrivendo il testo</button></div>` : ''}
    ${ideas.length ? `<div class="card"><span class="pill">SOLO FABIO E MARIO</span><h3>Idee dagli anni scorsi</h3>
      <p class="small">Schede pubblicate in questo periodo nelle stagioni passate. «Riusa» crea una nuova bozza da adattare: nulla viene pubblicato senza la tua approvazione.</p>
      ${ideas.map((w) => `<div class="checkline"><span class="who"><b>${esc(w.published.title)}</b><br><span class="small">Stagione ${esc(seasonOf(pubDate(w)))} · ${esc(dayY(pubDate(w)))}</span></span>
        <button class="ghost sm" data-act="wRead" data-id="${w.id}">Leggi</button><button class="alt sm" data-act="wReuse" data-id="${w.id}">Riusa</button></div>`).join('')}</div>` : ''}
    <h3>Schede di questa stagione (${esc(cur)})</h3>
    ${pub.length ? pub.map((w) => pubCard(w, false)).join('') : '<div class="card muted">Nessuna scheda pubblicata in questa stagione per ora.</div>'}
    ${pubAll.length ? `<div class="card"><h3>Storico allenamenti</h3>
      <p class="small">Tutte le schede approvate restano qui, stagione per stagione. Cerca per parola (es. «statica», «tabelle CO2», «settimana 1»).</p>
      <input id="wSearch" type="search" placeholder="Cerca negli allenamenti…" aria-label="Cerca negli allenamenti" autocomplete="off">
      <div id="wResults" class="hidden"></div>
      <div id="wSeasons">${seasons.length ? seasons.map((sn, i) => { const list = old.filter((w) => seasonOf(pubDate(w)) === sn).sort((x, y) => pubDate(x).localeCompare(pubDate(y)));
        return `<details><summary>Stagione ${esc(sn)} · ${list.length} ${list.length === 1 ? "scheda" : "schede"}</summary><div class="histlist">${list.map(histItem).join('')}</div></details>`; }).join('')
        : '<p class="small">Le stagioni passate compariranno qui da settembre: le schede di quest\'anno diventeranno lo storico.</p>'}</div></div>` : ''}
    ${canWorkouts() && drafts.length ? `<h3>Bozze e schede ritirate</h3>${drafts.map((w) => `<div class="card"><span class="pill ${w.status === 'bozza' ? 'gold' : 'grey'}">${w.status === 'bozza' ? 'BOZZA PRIVATA' : 'RITIRATA'}</span>
        <h3>${esc(w.title)}</h3><p class="small">Ultima modifica ${esc(dt(w.updated_at))}</p>
        <button class="alt" style="width:100%" data-act="wReview" data-id="${w.id}">Rivedi e pubblica</button></div>`).join('')}` : ''}
    <button class="alt" style="width:100%;margin-top:16px" data-act="go" data-view="home">⌂ Torna alla pagina iniziale</button>`;
  const q = main.querySelector('#wSearch');
  if (q) q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase(), res = $('wResults');
    $('wSeasons').classList.toggle('hidden', !!t); res.classList.toggle('hidden', !t);
    if (!t) return;
    const words = t.split(/\s+/);
    const hits = pubAll.filter((w) => { const x = plain(w); return words.every((k) => x.includes(k)); }).sort((x, y) => pubDate(y).localeCompare(pubDate(x)));
    res.innerHTML = hits.length ? `<p class="small">${hits.length} ${hits.length === 1 ? 'scheda trovata' : 'schede trovate'}</p><div class="histlist">${hits.slice(0, 50).map((w) => histItem(w).replace('</span></button>', ` · ${esc(seasonOf(pubDate(w)))}</span></button>`)).join('')}</div>` : '<p class="muted">Nessuna scheda trovata.</p>';
  });
}

// Riusa una scheda (anche di anni passati) come nuova bozza: stesso contenuto, da adattare e approvare
A.wReuse = async (el) => {
  const w = (S.workouts || []).find((x) => x.id === el.dataset.id); if (!w?.published) return;
  const title = prompt('Titolo della nuova bozza (puoi cambiarlo anche dopo)', w.published.title); if (!title?.trim()) return;
  const id = await act(async () => {
    const id = await rpc('create_workout', { p_title: title.trim().slice(0, 120) });
    await rpc('save_workout_version', { p_workout: id, p_base: null, p_title: title.trim().slice(0, 120), p_summary: w.published.summary || null,
      p_blocks: (w.published.blocks || []).map((b) => ({ title: b.title || '', body: b.body || '', uncertain: false, note: '' })), p_source: null });
    await rpc('set_workout_week', { p_workout: id, p_week: suggestWeek() });
    return id;
  }, 'Nuova bozza creata dalla scheda scelta: adattala e poi approvala', { button: el });
  if (id) openReview(id);
};

// ---------------- LETTURA ----------------
function readView(main) {
  const w = (S.workouts || []).find((x) => x.id === W.id);
  if (!w || !w.published) { W.mode = 'list'; return listView(main); }
  const v = w.published;
  main.innerHTML = `<button class="ghost" data-act="wList">← Tutti gli allenamenti</button>
    <div class="card"><span class="pill green">SCHEDA APPROVATA</span>${seasonOf((w.published_at || '').slice(0, 10) || todayISO()) !== seasonOf(todayISO()) ? ` <span class="pill grey">STORICO ${esc(seasonOf(w.published_at.slice(0, 10)))}</span>` : ''}<h2>${esc(v.title)}</h2>${w.week_of ? `<p><b>${esc(weekLabel(w.week_of)[0].toUpperCase() + weekLabel(w.week_of).slice(1))}</b></p>` : ''}${blocksHtml(v)}
      <p class="small">Scheda di consultazione approvata da ${esc(w.published_by || 'Fabio/Mario')} il ${esc(dt(w.published_at))}. Attenersi alle indicazioni tecniche e alle procedure di sicurezza stabilite dagli istruttori.</p></div>
    <div class="row"><button data-act="wPrint" data-id="${w.id}">Stampa / Salva PDF</button>
      </div>
    ${canWorkouts() ? `<div class="row" style="margin-top:8px"><button class="alt" data-act="wReuse" data-id="${w.id}">Riusa come nuova bozza</button></div>
      <div class="row" style="margin-top:8px"><button class="alt" data-act="wReview" data-id="${w.id}">✎ Modifica (nuova bozza)</button>
      <button class="warn" data-act="wUnpublish" data-id="${w.id}">Ritira pubblicazione</button></div>` : ''}`;
}

A.wList = () => { if (W.dirty && !confirm('Ci sono modifiche non salvate. Uscire comunque? (restano salvate su questo dispositivo)')) return; W.mode = 'list'; W.dirty = false; R.render(); };
A.wRead = (el) => { W.mode = 'read'; W.id = el.dataset.id; R.render(); window.scrollTo(0, 0); };
A.wPrint = (el) => {
  const w = S.workouts.find((x) => x.id === el.dataset.id); const v = w.published;
  printHtml(printHeader(`Allenamento · ${v.title}`, `Approvato il ${dt(w.published_at)}`) + blocksHtml(v) +
    '<p class="meta">Scheda di consultazione: attenersi alle indicazioni tecniche e alle procedure di sicurezza stabilite dagli istruttori.</p>');
};
A.wOriginal = async (el) => {
  const win = window.open('', '_blank'); // aperta subito: evita il blocco dei popup su iPhone
  try { const u = await signedUrl(CONFIG.pdfBucket, el.dataset.path, 60); if (win) win.location = u; else location.href = u; }
  catch (e) { if (win) win.close(); toast(e.message, true); }
};
A.wUnpublish = (el) => {
  if (!confirm('Ritirare la scheda? Lo staff non la vedrà più. Originale e versioni restano conservati.')) return;
  act(() => rpc('unpublish_workout', { p_workout: el.dataset.id }), 'Scheda ritirata').then(() => { W.mode = 'list'; R.render(); });
};

// ---------------- CARICAMENTO PDF ----------------
let pdfjsPromise = null;
async function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href; return m;
  });
  return pdfjsPromise;
}

async function extractLines(buf) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, enableXfa: false }).promise;
  const lines = []; let chars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i); const tc = await page.getTextContent();
    const ls = linesFromTextContent(tc.items); ls.forEach((l) => (chars += l.text.trim().length)); lines.push(...ls, '');
  }
  return { lines, pages: doc.numPages, chars };
}

A.pdfPicked = async (el) => {
  const file = el.files?.[0]; el.value = '';
  if (!file) return;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const isPdf = String.fromCharCode(...head) === '%PDF-';
  if (!isPdf) return toast('Il file scelto non è un PDF valido.', true);
  if (file.size > MAX_PDF) return toast('Il PDF supera 10 MB: riducilo o dividilo.', true);
  W.mode = 'upload'; W.upload = { file, status: 'Lettura del testo in corso…', items: null, error: null }; R.render();
  try {
    const { lines, pages, chars } = await extractLines(await file.arrayBuffer());
    if (chars < 20) {
      W.upload.status = `Il PDF (${pages} pagina/e) non contiene testo leggibile: probabilmente è una scansione o un'immagine. Puoi comunque archiviarlo e trascrivere la scheda a mano guardando l'originale.`;
      W.upload.items = [{ title: file.name.replace(/\.pdf$/i, ''), summary: '', blocks: [], source_text: '', header: '', pick: true, scanned: true }];
    } else {
      const items = parseWorkouts(lines, file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
      const have = new Set((S.workouts || []).filter((w) => seasonOf(pubDate(w)) === seasonOf(todayISO())).map((w) => normT(w.published?.title || w.title)));
      W.upload.items = items.map((x) => ({ ...x, pick: !have.has(normT(x.title)), present: have.has(normT(x.title)) }));
      W.upload.status = `Testo letto da ${pages} pagina/e. Ho trovato ${items.length} scheda/e. Scegli quali preparare: verranno create come BOZZE private.`;
    }
  } catch (e) {
    W.upload.error = 'Non riesco a leggere questo PDF (' + e.message + '). Puoi archiviarlo e scrivere la scheda a mano.';
    W.upload.items = [{ title: file.name.replace(/\.pdf$/i, ''), summary: '', blocks: [], source_text: '', header: '', pick: true, scanned: true }];
  }
  R.render();
};

function uploadView(main) {
  const u = W.upload;
  main.innerHTML = `<button class="ghost" data-act="wList">← Annulla</button><h2>Nuovo PDF: ${esc(u.file.name)}</h2>
    <div class="card"><p role="status">${esc(u.status)}</p>${u.error ? `<div class="error">${esc(u.error)}</div>` : ''}
    ${u.items ? u.items.map((x, i) => {
      const chk = x.scanned ? null : integrity(x.source_text, x);
      return `<div class="item"><label class="check"><input type="checkbox" data-change="upPick" data-i="${i}" ${x.pick ? 'checked' : ''}> <span><b>${esc(x.title)}</b>${x.present ? ' <span class="pill grey">già nell\'app</span>' : ''}<br>
        <span class="small">${x.blocks.length} blocchi proposti · ${x.blocks.filter((b) => b.uncertain).length} da verificare${chk ? (chk.ok ? ' · ✓ tutte le parole e i numeri del PDF sono presenti' : ' · ⚠︎ differenze da controllare') : ''}</span></span></label></div>`;
    }).join('') + `<label for="upWeek" style="margin-top:12px">La prima scheda selezionata vale dalla settimana del</label>
      <input type="date" id="upWeek" value="${esc(suggestWeek())}">
      <p class="small">Le altre schede selezionate prendono le settimane successive, in ordine. Puoi cambiare la settimana di ogni scheda anche dopo, in revisione.</p>
      <label class="check"><input type="checkbox" id="upArchive"> <span><b>Allenamenti di una stagione passata, già svolti:</b> archiviali direttamente nello storico, senza rivederli uno per uno. Possibile solo se per tutte le schede selezionate parole e numeri del PDF sono presenti.</span></label>
      <button style="width:100%;margin-top:10px" data-act="upCreate">Crea le bozze e archivia il PDF originale</button>
      <p class="small">Il PDF originale viene conservato in un archivio privato, visibile solo a Fabio e Mario. Le bozze non sono visibili allo staff.</p>` : '<p class="muted">Attendere…</p>'}</div>`;
}
// Settimana proposta: quella dopo l'ultima scheda con settimana, altrimenti la settimana in corso
function suggestWeek() {
  const weeks = (S.workouts || []).map((w) => w.week_of).filter(Boolean).sort();
  const next = weeks.length ? addDays(weeks[weeks.length - 1], 7) : mondayOf(todayISO());
  return next < mondayOf(todayISO()) ? mondayOf(todayISO()) : next;
}
A.upPick = (el) => { W.upload.items[+el.dataset.i].pick = el.checked; };
A.upCreate = async (el) => {
  const items = W.upload.items.filter((x) => x.pick);
  const firstWeek = $('upWeek')?.value ? mondayOf($('upWeek').value) : null;
  const archive = !!$('upArchive')?.checked;
  if (archive) {
    if (!firstWeek || seasonOf(firstWeek) === seasonOf(todayISO())) return toast('L\'archiviazione diretta è solo per stagioni passate: scegli una settimana di una stagione precedente', true);
    if (items.some((x) => x.scanned || !integrity(x.source_text, x).ok)) return toast('Alcune schede hanno differenze rispetto al PDF: togli la spunta e rivedile una per una', true);
    if (!confirm(`Archiviare ${items.length} schede nello storico della stagione ${seasonOf(firstWeek)}? Saranno consultabili dallo staff come storico.`)) return;
  }
  if (!items.length) return toast('Seleziona almeno una scheda', true);
  el.disabled = true; el.textContent = 'Salvataggio in corso…';
  const created = [];
  const ok = await act(async () => {
    for (const x of items) {
      const id = await rpc('create_workout', { p_title: x.title.slice(0, 120) });
      const path = `workouts/${id}/${Date.now()}-${W.upload.file.name.replace(/[^a-z0-9.]+/gi, '_').replace(/\.pdf$/i, '').slice(0, 60)}.pdf`;
      await uploadPdf(CONFIG.pdfBucket, path, W.upload.file);
      await rpc('register_workout_file', { p_workout: id, p_path: path, p_filename: W.upload.file.name, p_size: W.upload.file.size });
      const ver = await rpc('save_workout_version', { p_workout: id, p_base: null, p_title: x.title.slice(0, 120), p_summary: x.summary || null,
        p_blocks: x.blocks, p_source: x.source_text || null });
      if (archive) await rpc('publish_workout', { p_workout: id, p_version: ver, p_reviewed: true });
      if (firstWeek) await rpc('set_workout_week', { p_workout: id, p_week: addDays(firstWeek, 7 * created.length) });
      created.push(id);
    }
  }, null, { button: el });
  if (ok && archive) { toast(`${created.length} schede archiviate nello storico ${seasonOf(firstWeek)}`); W.upload = null; W.mode = 'list'; R.render(); }
  else if (ok) { toast(`${created.length} bozza/e create. Ora rivedile una per una.`); W.upload = null; openReview(created[0]); }
  else if (created.length) { toast(`Create ${created.length} bozze prima dell'errore: le trovi nell'elenco.`, true); W.mode = 'list'; R.render(); }
  else { el.textContent = 'Riprova: crea le bozze'; }
};

A.newBlank = async (el) => {
  const title = prompt('Titolo della scheda (es. «Novembre – Settimana 2»)'); if (!title?.trim()) return;
  const id = await act(async () => {
    const id = await rpc('create_workout', { p_title: title.trim() });
    await rpc('save_workout_version', { p_workout: id, p_base: null, p_title: title.trim(), p_summary: null, p_blocks: [], p_source: null });
    return id;
  }, 'Bozza creata', { button: el });
  if (id) openReview(id);
};

// ---------------- REVISIONE AFFIANCATA ----------------
A.wReview = (el) => openReview(el.dataset.id);
async function openReview(id) {
  try {
    const d = await rpc('app_workout_detail', { p_workout: id });
    W.id = id; W.detail = d; W.mode = 'review'; W.tab = 'scheda';
    const cur = d.current || { title: d.workout.title, summary: '', blocks: [], source_text: '' };
    let local = null; try { local = JSON.parse(localStorage.getItem(editKey(id)) || 'null'); } catch {}
    W.edit = { title: cur.title, summary: cur.summary || '', blocks: structuredClone(cur.blocks || []), source_text: cur.source_text || '', header: (cur.source_text || '').split('\n')[0] || '' };
    W.dirty = false;
    if (local && local.base === (d.workout.current_version_id || null) && JSON.stringify(local.blocks) !== JSON.stringify(W.edit.blocks)
        && confirm('Su questo dispositivo ci sono modifiche non salvate di questa bozza. Vuoi recuperarle?')) { W.edit = local; W.dirty = true; }
    W.edit.base = d.workout.current_version_id || null;
    R.render(); window.scrollTo(0, 0);
  } catch (e) { toast(e.message, true); }
}

function integrityHtml() {
  if (!W.edit.source_text) return '<div class="alert">Nessun testo estratto dal PDF: confronta manualmente con l\'originale.</div>';
  const c = integrity(W.edit.source_text, W.edit);
  if (c.ok) return '<div class="success">✓ Tutte le parole e i numeri del testo originale sono presenti nella scheda, e non ne sono stati aggiunti altri.</div>';
  const show = (a) => [...new Set(a)].slice(0, 25).map((t) => `<code>${esc(t)}</code>`).join(' ');
  return `<div class="alert diff"><b>Differenze rispetto al testo del PDF</b> — verifica che siano correzioni volute.<br>
    ${c.missing.length ? `Assenti nella scheda: ${show(c.missing)}<br>` : ''}${c.extra.length ? `Aggiunte nella scheda: ${show(c.extra)}` : ''}</div>`;
}

function reviewView(main) {
  const d = W.detail, e = W.edit, wk = d.workout;
  const unresolved = e.blocks.filter((b) => b.uncertain).length;
  const file = d.files?.[0];
  const sourcePanel = `<section><h3>Originale</h3>
      ${file ? `<button class="alt" style="width:100%" data-act="wOriginal" data-path="${esc(file.storage_path)}">Apri il PDF originale</button>` : '<p class="small">Nessun PDF allegato.</p>'}
      <p class="small">Testo estratto dal PDF, riga per riga, senza modifiche:</p>
      <div class="source">${esc(e.source_text || '(nessun testo estratto)')}</div>
      <details><summary>Correggi o incolla il testo originale</summary><textarea id="srcEdit" rows="10">${esc(e.source_text)}</textarea>
        <button class="alt sm" data-act="srcApply">Usa questo testo</button> <button class="alt sm" data-act="reparse">Riproponi la suddivisione</button></details>
    </section>`;
  const editPanel = `<section><h3>Scheda proposta</h3>
      <label for="wTitle">Titolo</label><input id="wTitle" maxlength="120" value="${esc(e.title)}" data-change="edTitle">
      <label for="wSummary">Indicazioni generali (distanza, attrezzatura, partenza…)</label><textarea id="wSummary" rows="4" data-change="edSummary">${esc(e.summary)}</textarea>
      ${e.blocks.map((b, i) => `<div class="blockedit ${b.uncertain ? 'uncertain' : ''}">
        <div class="row" style="justify-content:space-between;align-items:center"><b>Blocco ${i + 1}</b>
          <span><button class="ghost sm" data-act="bUp" data-i="${i}" aria-label="Sposta su" ${i ? '' : 'disabled'}>↑</button><button class="ghost sm" data-act="bDown" data-i="${i}" aria-label="Sposta giù" ${i < e.blocks.length - 1 ? '' : 'disabled'}>↓</button>
          <button class="ghost sm" data-act="bDel" data-i="${i}" aria-label="Elimina blocco">Elimina</button></span></div>
        ${b.uncertain ? `<div class="alert small">⚠︎ ${esc(b.note || 'Passaggio da verificare')}<br><button class="ok sm" data-act="bOk" data-i="${i}">Ho verificato questo blocco</button></div>` : ''}
        <label>Titolo / indicazione</label><input value="${esc(b.title)}" data-change="bTitle" data-i="${i}" maxlength="200">
        <label>Esercizi (una riga per esercizio)</label><textarea data-change="bBody" data-i="${i}">${esc(b.body || '')}</textarea>
        <button class="ghost sm" data-act="bFlag" data-i="${i}">${b.uncertain ? '' : '⚑︎ Segna come da verificare'}</button></div>`).join('')}
      <button class="alt" style="width:100%" data-act="bAdd">＋ Aggiungi blocco</button>
      <div id="integ">${integrityHtml()}</div>
      <h3>Anteprima per lo staff</h3><div class="card" id="wPreview">${blocksHtml(e)}</div>
    </section>`;
  main.innerHTML = `<button class="ghost" data-act="wList">← Tutti gli allenamenti</button>
    <h2>${esc(wk.title)}</h2>
    <p><span class="pill ${wk.status === 'pubblicato' ? 'green' : wk.status === 'bozza' ? 'gold' : 'grey'}">${wk.status.toUpperCase()}</span>
      ${wk.status === 'pubblicato' && wk.current_version_id !== wk.published_version_id ? '<span class="pill gold">la bozza differisce dalla versione pubblicata</span>' : ''}
      <span class="pill red ${W.dirty ? '' : 'hidden'}" id="dirtyPill">modifiche non salvate</span></p>
    <div class="alert small">Apnea: non modificare tempi, distanze, pause, ordine, assistenza o recuperi se non sei certo. In caso di dubbio lascia il blocco «da verificare» e chiedi a Fabio/Mario.</div>
    <div class="tabs" role="tablist"><button class="${W.tab === 'originale' ? 'active' : 'alt'}" data-act="tab" data-t="originale">Originale</button><button class="${W.tab === 'scheda' ? 'active' : 'alt'}" data-act="tab" data-t="scheda">Scheda</button></div>
    <div class="review" id="reviewGrid">${matchMedia('(min-width:900px)').matches ? sourcePanel + editPanel : (W.tab === 'originale' ? sourcePanel : editPanel)}</div>
    <div class="card"><h3>Settimana in cui si usa</h3>
      <p class="small">La scheda vale per tutte le serate della settimana, dal lunedì alla domenica. Scegli un giorno qualsiasi della settimana.</p>
      <input type="date" id="wWeek" value="${esc(wk.week_of || '')}" data-change="wWeek" aria-label="Settimana della scheda">
      <p class="small">${wk.week_of ? `<b>${esc(weekLabel(wk.week_of))}</b> <button class="ghost sm" data-act="wWeekClear">Togli</button>` : 'Nessuna settimana indicata.'}</p></div>
    <div class="card"><h3>Salva e pubblica</h3>
      <button style="width:100%" id="saveBtn" data-act="wSave" ${W.dirty ? '' : 'disabled'}>Salva bozza (nuova versione)</button>
      <label class="check"><input type="checkbox" id="pubCheck"> <span>Ho confrontato la scheda con il PDF originale: distanze, tempi, recuperi, ordine e indicazioni di sicurezza sono corretti.</span></label>
      <p class="small">Lo staff vede solo la scheda approvata. Il PDF originale resta archiviato per Fabio e Mario.</p>
      ${unresolved ? `<div class="alert">Ci sono ${unresolved} blocchi da verificare: risolvili prima di pubblicare.</div>` : ''}
      <button class="ok" style="width:100%" id="pubBtn" data-act="wPublish" ${unresolved || W.dirty ? 'disabled' : ''}>✓ Approva e pubblica</button>
      <p class="small ${W.dirty ? '' : 'hidden'}" id="saveFirst">Salva la bozza prima di pubblicare.</p>
      ${wk.status === 'pubblicato' ? `<button class="warn" style="width:100%;margin-top:8px" data-act="wUnpublish" data-id="${wk.id}">Ritira pubblicazione</button>` : ''}
    </div>
    <details class="card"><summary>Versioni salvate (${d.versions.length})</summary>${d.versions.map((v) => `<div class="item"><b>v${v.version_no}</b> · ${esc(dt(v.created_at))} · ${esc(v.created_by || '')}${v.approved_at ? ' · <span class="pill green">approvata</span>' : ''}
      ${v.id !== wk.current_version_id ? `<button class="ghost sm" data-act="wLoadVersion" data-id="${v.id}">Riparti da questa</button>` : ' <span class="small">(attuale)</span>'}</div>`).join('')}</details>
    <button class="ghost" data-act="wExportTxt">↓ Scarica il testo della scheda</button>`;
}

const touch = () => { W.dirty = true; keepLocal(); };
const rerender = () => { const y = window.scrollY; R.render(); window.scrollTo(0, y); };
A.tab = (el) => { W.tab = el.dataset.t; rerender(); };
// Le modifiche di testo aggiornano solo controllo e anteprima (il campo resta attivo)
function refreshSide() {
  const unresolved = W.edit.blocks.some((b) => b.uncertain);
  if ($('integ')) $('integ').innerHTML = integrityHtml();
  if ($('wPreview')) $('wPreview').innerHTML = blocksHtml(W.edit);
  $('dirtyPill')?.classList.toggle('hidden', !W.dirty); $('saveFirst')?.classList.toggle('hidden', !W.dirty);
  if ($('saveBtn')) $('saveBtn').disabled = !W.dirty;
  if ($('pubBtn')) $('pubBtn').disabled = W.dirty || unresolved;
}
const edited = () => { touch(); refreshSide(); };
A.edTitle = (el) => { W.edit.title = el.value; edited(); };
A.edSummary = (el) => { W.edit.summary = el.value; edited(); };
A.bTitle = (el) => { W.edit.blocks[+el.dataset.i].title = el.value; edited(); };
A.bBody = (el) => { W.edit.blocks[+el.dataset.i].body = el.value; edited(); };
A.bUp = (el) => { const i = +el.dataset.i, b = W.edit.blocks; [b[i - 1], b[i]] = [b[i], b[i - 1]]; touch(); rerender(); };
A.bDown = (el) => { const i = +el.dataset.i, b = W.edit.blocks; [b[i + 1], b[i]] = [b[i], b[i + 1]]; touch(); rerender(); };
A.bDel = (el) => { if (!confirm('Eliminare questo blocco?')) return; W.edit.blocks.splice(+el.dataset.i, 1); touch(); rerender(); };
A.bAdd = () => { W.edit.blocks.push({ title: '', body: '', uncertain: false, note: '' }); touch(); rerender(); };
A.bOk = (el) => { const b = W.edit.blocks[+el.dataset.i]; b.uncertain = false; b.note = ''; touch(); rerender(); };
A.bFlag = (el) => { const b = W.edit.blocks[+el.dataset.i]; if (!b.uncertain) { b.uncertain = true; b.note = 'Segnato da verificare'; touch(); rerender(); } };
A.srcApply = () => { W.edit.source_text = $('srcEdit').value; W.edit.header = W.edit.source_text.split('\n')[0] || ''; touch(); rerender(); };
A.reparse = () => {
  const src = $('srcEdit')?.value ?? W.edit.source_text;
  if (!confirm('Riproporre la suddivisione dal testo originale? I blocchi attuali verranno sostituiti (puoi sempre tornare a una versione salvata).')) return;
  const [p] = parseWorkouts(src.split('\n'), W.edit.title);
  if (!p) return toast('Testo vuoto', true);
  Object.assign(W.edit, { summary: p.summary, blocks: p.blocks, source_text: src, header: p.header }); touch(); rerender();
};

A.wSave = (el) => act(async () => {
  const clean = W.edit.blocks.map((b) => ({ title: String(b.title || ''), body: String(b.body || ''), uncertain: !!b.uncertain, note: String(b.note || '') }));
  await rpc('save_workout_version', { p_workout: W.id, p_base: W.edit.base, p_title: W.edit.title.trim() || 'Allenamento',
    p_summary: W.edit.summary || null, p_blocks: clean, p_source: W.edit.source_text || null });
  dropLocal(W.id); W.dirty = false;
  const d = await rpc('app_workout_detail', { p_workout: W.id }); W.detail = d; W.edit.base = d.workout.current_version_id;
}, 'Bozza salvata: visibile solo a Fabio e Mario', { button: el });

const setWeek = (week) => act(() => rpc('set_workout_week', { p_workout: W.id, p_week: week }), week ? `Scheda valida per la ${weekLabel(week)}` : 'Settimana tolta')
  .then((ok) => { if (ok !== false) { W.detail.workout.week_of = week; rerender(); } });
A.wWeek = (el) => { if (el.value) setWeek(mondayOf(el.value)); };
A.wWeekClear = () => setWeek(null);
A.wPublish = (el) => {
  if (!$('pubCheck').checked) return toast('Conferma di aver controllato la scheda rispetto all\'originale', true);
  if (!confirm('Pubblicare questa scheda? Tutto lo staff potrà leggerla e stamparla.')) return;
  act(() => rpc('publish_workout', { p_workout: W.id, p_version: W.detail.workout.current_version_id, p_reviewed: true }),
    'Scheda pubblicata allo staff', { button: el }).then((ok) => { if (ok && W.mode === 'review') { W.mode = 'read'; R.render(); } });
};

A.wLoadVersion = async (el) => {
  if (W.dirty && !confirm('Le modifiche non salvate andranno perse. Continuare?')) return;
  try {
    const v = await rpc('app_workout_version', { p_version: el.dataset.id });
    Object.assign(W.edit, { title: v.title, summary: v.summary || '', blocks: v.blocks || [], source_text: v.source_text || '' });
    touch(); toast(`Caricata la versione ${v.version_no}: salva per renderla la bozza attuale`); rerender();
  } catch (e) { toast(e.message, true); }
};

A.wExportTxt = () => {
  const e = W.edit; const s = [e.title, '', e.summary, '', ...e.blocks.map((b) => `${b.title}\n${b.body}`)].join('\n');
  download(`${e.title.replace(/[^a-z0-9]+/gi, '_')}.txt`, s, 'text/plain;charset=utf-8');
};

// esposto per test e per tornare all'elenco quando si cambia sezione
export const workoutState = W;
