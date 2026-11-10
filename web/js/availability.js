// Club dei Mari · Disponibilità dichiarate dallo staff (mese per mese)
// e «mese di scarico» dopo un mese di allenamenti, per aiutare Mario.
import { rpc } from './api.js';
import { $, esc, S, R, A, act, toast, todayISO, humanShort, hhmm, KIND, availOf, availNote, staffName } from './core.js';

const DOW = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const isoDow = (date) => { const d = new Date(date + 'T12:00').getDay(); return d === 0 ? 7 : d; };
export const ymOf = (date) => date.slice(0, 7);
export const shiftYM = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthName = (ym) => new Date(ym + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const teaches = (p, kind) => kind === 'altro' || (kind === 'corso' ? p?.teaches_courses !== false : p?.teaches_trainings !== false);

// Serate future del mese che questa persona può seguire
export function myMonthActivities(ym, me = S.me) {
  const t = todayISO();
  return (S.data?.activities || []).filter((a) => a.status === 'attiva' && a.date >= t && ymOf(a.date) === ym && teaches(me, a.kind));
}

// Mese di scarico: ha seguito allenamenti nel mese precedente e non ne ha ancora in questo
export function restInfo(profileId, ym) {
  const prev = shiftYM(ym, -1);
  const had = (ymX) => (S.data?.activities || []).some((a) => a.kind === 'allenamento' && a.status === 'attiva' && ymOf(a.date) === ymX
    && a.assignments.some((s) => s.profile_id === profileId));
  return had(prev) && !had(ym) ? monthName(prev).split(' ')[0] : null;
}
export function confirmRest(profileId, activityDate, kind) {
  if (kind !== 'allenamento') return true;
  const m = restInfo(profileId, ymOf(activityDate));
  return !m || confirm(`${staffName(profileId)} ha seguito gli allenamenti a ${m}: di solito questo è il suo mese di scarico. Assegnarlo comunque?`);
}

// Mesi (nel periodo caricato e nelle stagioni) per cui l'utente non ha ancora dichiarato nulla
export function undeclaredMonths(limit = 2) {
  const out = []; let ym = ymOf(todayISO());
  for (let i = 0; i < 4 && out.length < limit; i++, ym = shiftYM(ym, 1)) {
    const acts = myMonthActivities(ym); if (!acts.length) continue;
    if (!acts.some((a) => availOf(S.me.id, a.id) !== undefined) && !availNote(S.me.id, ym)) out.push(ym);
  }
  return out;
}
export function homeAvailBanner() {
  const ms = undeclaredMonths();
  if (!ms.length) return '';
  return `<div class="card soft"><h3>Le tue disponibilità</h3><p>Dichiara in quali serate ci sei per ${ms.map((m) => `<b>${esc(monthName(m))}</b>`).join(' e ')}: Mario le userà per preparare i turni.</p>
    <button style="width:100%" data-act="availOpen" data-m="${ms[0]}">Indica le disponibilità</button></div>`;
}

const V = { month: null };
A.availOpen = (el) => { V.month = el.dataset.m || ymOf(todayISO()); A.go({ dataset: { view: 'avail' } }); };

export function renderAvail(main) {
  V.month = V.month || ymOf(todayISO());
  const acts = myMonthActivities(V.month);
  const groups = new Map();
  for (const a of acts) { const k = `${isoDow(a.date)}|${a.kind}|${hhmm(a.start_time)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  const yes = acts.filter((a) => availOf(S.me.id, a.id) === true).length, no = acts.filter((a) => availOf(S.me.id, a.id) === false).length;
  const chip = (a) => { const v = availOf(S.me.id, a.id);
    return `<button class="sm ${v === true ? 'ok' : v === false ? 'warn' : 'alt'}" data-act="availToggle" data-id="${a.id}" aria-label="${esc(humanShort(a.date))}: ${v === true ? 'ci sono' : v === false ? 'non ci sono' : 'non dichiarato'}">${esc(humanShort(a.date).replace(/^\S+\s/, ''))} ${v === true ? '✓' : v === false ? '✕' : '?'}</button>`; };
  main.innerHTML = `<h2>Le mie disponibilità</h2>
    <p class="muted">Per ogni serata indica se ci sei (✓) o no (✕). Tocca una data per cambiarla. Mario vede le tue risposte quando prepara i turni; gli altri istruttori no.</p>
    <div class="calbar"><button class="alt sm" data-act="availMonth" data-n="-1" aria-label="Mese precedente" ${V.month <= ymOf(todayISO()) ? 'disabled' : ''}>‹</button>
      <b style="flex:3;text-align:center;text-transform:capitalize">${esc(monthName(V.month))}</b>
      <button class="alt sm" data-act="availMonth" data-n="1" aria-label="Mese successivo">›</button></div>
    ${!acts.length ? '<div class="card muted">Nessuna serata da dichiarare in questo mese (fuori stagione, già passate o non previste per il tuo ruolo).</div>' : `
    ${weeklyHtml()}
    <div class="row"><button class="ok" data-act="availAll" data-v="1">Ci sono a tutte</button><button class="warn" data-act="availAll" data-v="0">Non ci sono per tutto il mese</button></div>
    <p class="small">${yes} sì · ${no} no · ${acts.length - yes - no} da dichiarare</p>
    ${[...groups.entries()].map(([k, list]) => { const [d, kind, t] = k.split('|');
      return `<div class="card" style="padding:12px"><b style="text-transform:capitalize">${DOW[d]}</b> · ${esc(KIND[kind])}${t ? ' · ' + t : ''}
        <div class="row" style="gap:6px;margin:8px 0">${list.map(chip).join('')}</div>
        <div class="row"><button class="ghost sm" data-act="availGroup" data-k="${k}" data-v="1">Tutti sì</button><button class="ghost sm" data-act="availGroup" data-k="${k}" data-v="0">Tutti no</button><button class="ghost sm" data-act="availGroup" data-k="${k}" data-v="">Azzera</button></div></div>`; }).join('')}
    <div class="card"><label for="availNote">Note per Mario su ${esc(monthName(V.month))} (facoltative)</label>
      <textarea id="availNote" maxlength="500" placeholder="es. il martedì finisco di lavorare alle 21:30; in ferie dal 10 al 20">${esc(availNote(S.me.id, V.month))}</textarea>
      <button class="alt" style="width:100%" data-act="availNoteSave">Salva la nota</button></div>`}
    <button class="alt" style="width:100%;margin-top:16px" data-act="go" data-view="mine">← I miei turni</button>`;
}

// Disponibilità ricorrente: «ci sono tutti i martedì e giovedì», per il mese o fino a fine stagione
const DOW_SHORT = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
function seasonEndFor(ym) {
  const s = (S.data?.seasons || []).find((x) => x.start_date.slice(0, 7) <= ym && x.end_date.slice(0, 7) >= ym);
  return s ? s.end_date : null;
}
function scopeActs(scope) {
  const t = todayISO(), end = scope === 'season' ? seasonEndFor(V.month) : null;
  return (S.data?.activities || []).filter((a) => a.status === 'attiva' && a.date >= t && teaches(S.me, a.kind)
    && (end ? a.date >= V.month + '-01' && a.date <= end : ymOf(a.date) === V.month));
}
function weeklyHtml() {
  const end = seasonEndFor(V.month);
  const days = [...new Set(scopeActs(end ? 'season' : 'month').map((a) => isoDow(a.date)))].sort();
  if (days.length < 2) return '';
  return `<details class="card" id="weekly"><summary>Ripeti ogni settimana (es. «ci sono tutti i martedì e giovedì»)</summary>
    <p class="small">Scegli i giorni in cui di solito ci sei. Poi puoi correggere le singole date qui sotto per le eccezioni.</p>
    <div class="row">${days.map((d) => `<label class="check" style="flex:0 0 auto"><input type="checkbox" class="wkDay" value="${d}"> ${DOW_SHORT[d]}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" id="wkOthers" checked> Negli altri giorni segna «non ci sono»</label>
    ${end ? `<label for="wkScope">Per quale periodo</label><select id="wkScope"><option value="month">Solo ${esc(monthName(V.month))}</option><option value="season">Da ${esc(monthName(V.month))} a fine stagione (${esc(humanShort(end))})</option></select>` : ''}
    <button style="width:100%" data-act="availWeekly">Applica</button></details>`;
}
A.availWeekly = async (el) => {
  const days = [...document.querySelectorAll('.wkDay:checked')].map((x) => +x.value);
  if (!days.length) return toast('Scegli almeno un giorno', true);
  const others = $('wkOthers').checked, scope = $('wkScope')?.value || 'month';
  const acts = scopeActs(scope);
  const yes = acts.filter((a) => days.includes(isoDow(a.date))).map((a) => a.id);
  const no = others ? acts.filter((a) => !days.includes(isoDow(a.date))).map((a) => a.id) : [];
  const period = scope === 'season' ? `da ${monthName(V.month)} a fine stagione` : monthName(V.month);
  if (!confirm(`Segno che ci sei ${days.map((d) => DOW[d]).join(', ')} (${yes.length} serate)${others ? ` e che non ci sei negli altri giorni (${no.length} serate)` : ''}, per ${period}. Le risposte già date in quelle serate vengono sostituite. Confermi?`)) return;
  const chunks = (ids) => { const out = []; for (let i = 0; i < ids.length; i += 150) out.push(ids.slice(i, i + 150)); return out; };
  const y = window.scrollY;
  await act(async () => {
    for (const c of chunks(yes)) await rpc('set_my_availability', { p_activities: c, p_available: true });
    for (const c of chunks(no)) await rpc('set_my_availability', { p_activities: c, p_available: false });
  }, `Disponibilità salvate per ${period}: ora correggi le eccezioni`, { button: el });
  window.scrollTo(0, y);
};

const save = (ids, v, msg) => { const y = window.scrollY;
  return act(() => rpc('set_my_availability', { p_activities: ids, p_available: v }), msg).then(() => window.scrollTo(0, y)); };
A.availMonth = (el) => { V.month = shiftYM(V.month, +el.dataset.n); R.render(); window.scrollTo(0, 0); };
A.availToggle = (el) => { const cur = availOf(S.me.id, el.dataset.id); save([el.dataset.id], cur === undefined ? true : cur === true ? false : null, null); };
A.availAll = (el) => {
  const ids = myMonthActivities(V.month).map((a) => a.id);
  if (el.dataset.v === '0' && !confirm(`Confermi che non ci sei per tutto ${monthName(V.month)}?`)) return;
  save(ids, el.dataset.v === '1', el.dataset.v === '1' ? 'Segnato: ci sei a tutte le serate' : 'Segnato: non ci sei per tutto il mese');
};
A.availGroup = (el) => {
  const [d, kind, t] = el.dataset.k.split('|');
  const ids = myMonthActivities(V.month).filter((a) => String(isoDow(a.date)) === d && a.kind === kind && hhmm(a.start_time) === t).map((a) => a.id);
  save(ids, el.dataset.v === '' ? null : el.dataset.v === '1', 'Disponibilità aggiornate');
};
A.availNoteSave = (el) => act(() => rpc('set_my_availability_note', { p_month: V.month + '-01', p_note: $('availNote').value }), 'Nota salvata', { button: el });

// ---------- Per Mario: riepilogo del mese ----------
export function availSummaryHtml(ym, staff) {
  const acts = (S.data?.activities || []).filter((a) => a.status === 'attiva' && ymOf(a.date) === ym);
  if (!acts.length) return '';
  const rows = staff.filter((p) => acts.some((a) => teaches(p, a.kind))).map((p) => {
    const mine = acts.filter((a) => teaches(p, a.kind));
    const y = mine.filter((a) => availOf(p.id, a.id) === true).length, n = mine.filter((a) => availOf(p.id, a.id) === false).length;
    const note = availNote(p.id, ym), rest = restInfo(p.id, ym);
    return `<div class="item"><b>${esc(p.display_name)}</b> · ${y || n ? `${y} sì, ${n} no${mine.length - y - n ? `, ${mine.length - y - n} non dichiarate` : ''}` : '<span class="pill grey">non ha ancora dichiarato</span>'}
      ${rest ? ` <span class="pill gold">scarico: ha allenato a ${esc(rest)}</span>` : ''}${note ? `<div class="small">Nota: ${esc(note)}</div>` : ''}</div>`;
  });
  return `<details class="card"><summary>Disponibilità dichiarate per ${esc(monthName(ym))}</summary>${rows.join('')}
    <p class="small">Chi non ha dichiarato può comunque essere assegnato. Nell'elenco «＋ aggiungi» compaiono prima i disponibili.</p></details>`;
}

// Chi non ha ancora dichiarato nulla per il mese (né serate né nota)
export function missingFor(ym, staff) {
  const acts = (S.data?.activities || []).filter((a) => a.status === 'attiva' && ymOf(a.date) === ym && a.date >= todayISO());
  return staff.filter((p) => { const mine = acts.filter((a) => teaches(p, a.kind));
    return mine.length && !mine.some((a) => availOf(p.id, a.id) !== undefined) && !availNote(p.id, ym); });
}
const reminderText = (ym, names) => `Ciao a tutti, promemoria per chi non l'ha ancora fatto: indicate nell'app dello staff le vostre disponibilità per ${monthName(ym)}, così posso preparare i turni.
Si fa da «I miei turni» → «Le mie disponibilità»: ${location.origin + location.pathname}
Mancano ancora: ${names.join(', ')}.
Grazie!`;
// Per Mario: promemoria pronto da mandare su WhatsApp a chi non ha risposto
export function reminderHtml(ym, staff) {
  const miss = missingFor(ym, staff);
  if (!miss.length) return '';
  const names = miss.map((p) => p.display_name);
  return `<div class="card soft" id="remCard"><h3>Disponibilità mancanti per ${esc(monthName(ym))} (${miss.length})</h3>
    <p>Non hanno ancora dichiarato nulla: <b>${names.map(esc).join(', ')}</b>.</p>
    <div class="row"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(reminderText(ym, names))}">Manda il promemoria su WhatsApp</a>
      <button class="alt" data-act="remCopy" data-m="${ym}">Copia il messaggio</button></div>
    <p class="small">WhatsApp si apre con il messaggio già scritto: scegli il gruppo dello staff o le singole persone. Anche nell'app, finché non rispondono, vedono in prima pagina l'invito a indicare le disponibilità.</p></div>`;
}
A.remCopy = async (el) => {
  const names = missingFor(el.dataset.m, (S.data?.staff || []).filter((p) => p.active)).map((p) => p.display_name);
  try { await navigator.clipboard.writeText(reminderText(el.dataset.m, names)); toast('Messaggio copiato: incollalo su WhatsApp'); }
  catch { toast('Copia non riuscita: usa il pulsante WhatsApp', true); }
};

// Opzioni del menu «aggiungi» ordinate: disponibili, non dichiarati, non disponibili
export function addOptions(a, candidates) {
  const rank = (p) => { const v = availOf(p.id, a.id); return v === true ? 0 : v === undefined ? 1 : 2; };
  return candidates.slice().sort((x, y) => rank(x) - rank(y) || x.display_name.localeCompare(y.display_name)).map((p) => {
    const v = availOf(p.id, a.id); const rest = a.kind === 'allenamento' ? restInfo(p.id, ymOf(a.date)) : null;
    const tag = v === true ? ' — disponibile' : v === false ? ' — NON disponibile' : ' — non ha dichiarato';
    return `<option value="${p.id}">${esc(p.display_name)}${tag}${rest ? ' · mese di scarico' : ''}</option>`;
  }).join('');
}
