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

// Opzioni del menu «aggiungi» ordinate: disponibili, non dichiarati, non disponibili
export function addOptions(a, candidates) {
  const rank = (p) => { const v = availOf(p.id, a.id); return v === true ? 0 : v === undefined ? 1 : 2; };
  return candidates.slice().sort((x, y) => rank(x) - rank(y) || x.display_name.localeCompare(y.display_name)).map((p) => {
    const v = availOf(p.id, a.id); const rest = a.kind === 'allenamento' ? restInfo(p.id, ymOf(a.date)) : null;
    const tag = v === true ? ' — disponibile' : v === false ? ' — NON disponibile' : ' — non ha dichiarato';
    return `<option value="${p.id}">${esc(p.display_name)}${tag}${rest ? ' · mese di scarico' : ''}</option>`;
  }).join('');
}
