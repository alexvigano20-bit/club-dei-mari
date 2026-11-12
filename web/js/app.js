// Club dei Mari · app principale: accesso, navigazione, turni, calendario, comunicazioni
import { CONFIG } from './config.js';
import { signIn, signOut, changePassword, hasSession, sessionUserId, rpc, ApiError } from './api.js';
import {
  $, esc, S, R, A, act, toast, loadState, readCache, wipeLocal, todayISO, iso, parseISO, human, humanShort, monthLabel,
  addMonths, hhmm, dt, KIND, activityLabel, isAdmin, canWorkouts, canAttendance, staffName, activeStaff,
  myAssignments, responseOf, openRequests, printHtml, printHeader, openSheet, closeSheet, sheetOpen, defaultRange, hooks } from './core.js';
import { startMonitor, track, trackError } from './monitor.js';
import { renderWork, thisWeekWorkouts, workoutLinkHtml, weekLabel } from './workouts.js';
import { iconMine, iconWork, iconCal, iconNotices, NAV_ICONS } from './icons.js';
import { renderAvail, homeAvailBanner } from './availability.js';
import { renderAdmin, renderAttendance, renderPlan, dayAdminHtml, replacementForm } from './admin.js';

const VIEWS = ['home', 'mine', 'work', 'calendar', 'notices', 'admin', 'attendance', 'plan', 'avail', 'tour'];
let selectedDay = null;
let calMonthsBack = 0;

// ======================= AVVIO =======================
async function boot() {
  registerSW();
  wireEvents();
  startMonitor(); hooks.onActError = trackError;
  $('foot').textContent = CONFIG.environment === 'produzione' ? '' : `Ambiente: ${CONFIG.environment.toUpperCase()} — non inserire dati reali.`;
  if (!hasSession()) return renderLogin();
  try {
    await loadState();
  } catch (e) {
    if (e.offline) {
      const c = readCache(sessionUserId());
      if (c) { Object.assign(S, { me: c.me, data: c.data, workouts: c.workouts, range: c.range, fromCache: true, cacheTime: c.at }); }
      else return renderOfflineEmpty();
    } else return handleAuthFailure(e);
  }
  if (S.me.must_change_password) return renderChangePassword(true);
  track('apertura');
  route(location.hash.slice(1) || 'home', true);
  if (!localSeen('tour.v2')) go('tour');
}

function handleAuthFailure(e) {
  if (e?.code === 'revoked' || e?.status === 401 || e?.status === 403) {
    wipeLocal();
    renderLogin(e.code === 'revoked' || /disattivato/.test(e.message) ? 'Il tuo accesso è stato disattivato dal responsabile del club. I dati salvati su questo telefono sono stati cancellati.' : 'Sessione scaduta: accedi di nuovo.');
  } else { renderLogin(e.message); }
}

// Controllo periodico: se Mario revoca l'accesso, anche i dispositivi aperti lo scoprono
async function recheck() {
  if (!S.me || !navigator.onLine || document.hidden) return;
  try {
    const me = await rpc('whoami');
    if (!me) return handleAuthFailure(new ApiError('revocato', { code: 'revoked' }));
    await loadState(); if (!sheetOpen()) R.render();
  } catch (e) { if (!e.offline) handleAuthFailure(e); }
}

const localSeen = (k) => { try { return localStorage.getItem(`cdm.seen.${k}.${S.me?.id}`) === '1'; } catch { return true; } };
const markSeen = (k) => { try { localStorage.setItem(`cdm.seen.${k}.${S.me?.id}`, '1'); } catch {} };

// ======================= ACCESSO =======================
function chrome(show) {
  $('bottomnav').classList.toggle('hidden', !show);
  $('guideBtn').classList.toggle('hidden', !show);
}

function renderLogin(message = '') {
  chrome(false);
  $('greeting').textContent = 'Area staff';
  $('subtitle').textContent = 'Accedi con le credenziali ricevute da Mario';
  $('main').innerHTML = `
    <form class="card login" id="loginForm" autocomplete="on">
      <h2>Accedi</h2>
      ${message ? `<div class="alert">${esc(message)}</div>` : ''}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" inputmode="email" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required minlength="8">
      <label class="check"><input type="checkbox" id="showPw"> Mostra password</label>
      <button type="submit" style="width:100%">Entra</button>
      <p class="small">Hai dimenticato la password? Chiedi a Mario di reimpostarla: ti darà una password temporanea.</p>
      <div id="loginErr" role="alert"></div>
    </form>`;
  $('showPw').addEventListener('change', (e) => { $('password').type = e.target.checked ? 'text' : 'password'; });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Accesso in corso…';
    try {
      await signIn($('email').value, $('password').value);
      await loadState();
      if (S.me.must_change_password) return renderChangePassword(true);
      track('apertura'); route('home'); if (!localSeen('tour.v2')) go('tour');
    } catch (err) {
      if (err.code === 'revoked') wipeLocal();
      $('loginErr').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Entra';
    }
  });
}

function renderChangePassword(first) {
  chrome(!first);
  $('main').innerHTML = `
    <form class="card login" id="pwForm">
      <h2>${first ? 'Scegli la tua password' : 'Cambia password'}</h2>
      ${first ? '<p class="muted">È il tuo primo accesso con una password temporanea. Scegline una personale (almeno 8 caratteri) e conservala.</p>' : ''}
      <label for="pw1">Nuova password</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required>
      <label for="pw2">Ripeti la password</label><input id="pw2" type="password" autocomplete="new-password" minlength="8" required>
      <button type="submit" style="width:100%">Salva password</button>
      ${first ? '' : '<button type="button" class="alt" style="width:100%;margin-top:8px" data-act="go" data-view="home">Annulla</button>'}
      <div id="pwErr" role="alert"></div>
    </form>`;
  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('pw1').value, b = $('pw2').value;
    if (a.length < 8) return ($('pwErr').innerHTML = '<div class="error">Almeno 8 caratteri.</div>');
    if (a !== b) return ($('pwErr').innerHTML = '<div class="error">Le due password non coincidono.</div>');
    try {
      await changePassword(a); await rpc('mark_password_changed'); await loadState();
      toast('Password salvata'); track('apertura'); route('home'); if (!localSeen('tour.v2')) go('tour');
    } catch (err) { $('pwErr').innerHTML = `<div class="error">${esc(err.message)}</div>`; }
  });
}

function renderOfflineEmpty() {
  chrome(false);
  $('main').innerHTML = '<div class="card"><h2>Sei offline</h2><p>Per il primo accesso serve una connessione internet. Riprova quando sei collegato.</p><button data-act="reload">Riprova</button></div>';
}

// ======================= NAVIGAZIONE =======================
function go(view) { route(view); }
function route(view, replace = false) {
  if (!VIEWS.includes(view)) view = 'home';
  if (view === 'admin' && !isAdmin()) view = 'home';
  if ((view === 'attendance' && !canAttendance()) || (view === 'plan' && !isAdmin())) view = 'home';
  S.scroll[S.view] = window.scrollY;
  S.view = view;
  track('sezione', view);
  const h = view === 'home' ? '' : '#' + view;
  if (replace) history.replaceState(null, '', location.pathname + h); else if (location.hash !== h) history.pushState(null, '', location.pathname + h);
  closeSheet();
  render();
  window.scrollTo(0, view === 'calendar' ? 0 : (S.scroll[view] || 0));
  if (view === 'calendar') requestAnimationFrame(() => document.querySelector('.monthcard.current')?.scrollIntoView({ block: 'start' }));
}

function render() {
  if (!S.me) return;
  chrome(S.view !== 'tour');
  $('greeting').textContent = `Ciao ${S.me.display_name}!`;
  $('subtitle').textContent = isAdmin() ? 'Responsabile del club' : canWorkouts() ? 'Staff · allenamenti' : 'Turni e allenamenti, senza complicazioni.';
  document.querySelectorAll('.bottomnav button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  const n = openRequests().length + 0;
  $('noticeBadge').textContent = n; $('noticeBadge').classList.toggle('hidden', !n || !isAdmin());
  renderBanner();
  $('app').classList.toggle('wide', S.view === 'work');
  const main = $('main');
  ({ home: renderHome, mine: renderMine, work: renderWork, calendar: renderCalendar, notices: renderNotices,
     admin: renderAdmin, attendance: renderAttendance, plan: renderPlan, avail: renderAvail, tour: renderTour })[S.view](main);
}
R.render = render;

function renderBanner() {
  const b = $('banner');
  if (!navigator.onLine || S.fromCache) {
    b.textContent = `Sei offline: stai vedendo i dati aggiornati al ${dt(S.cacheTime)}. Le modifiche sono disattivate finché non torni online.`;
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
}

const backBtn = () => '<button class="alt" style="width:100%;margin-top:16px" data-act="go" data-view="home">⌂ Torna alla pagina iniziale</button>';

// ======================= HOME =======================
function upcomingMine(limit = 99) {
  const t = todayISO();
  return myAssignments().filter((x) => x.activity.date >= t && x.activity.status === 'attiva').slice(0, limit);
}

function renderHome(main) {
  const next = upcomingMine(2);
  const open = openRequests().length;
  const drafts = (S.workouts || []).filter((w) => w.status === 'bozza').length;
  main.innerHTML = `
    <div class="hero">
      <button class="tile" data-act="go" data-view="mine"><span class="ico">${iconMine()}</span>I miei turni</button>
      <button class="tile" data-act="go" data-view="work"><span class="ico">${iconWork()}</span>Allenamenti${canWorkouts() && drafts ? `<span class="count">${drafts} bozza/e</span>` : ''}</button>
      <button class="tile" data-act="go" data-view="calendar"><span class="ico">${iconCal()}</span>Calendario</button>
      <button class="tile" data-act="go" data-view="notices"><span class="ico">${iconNotices()}</span>Comunicazioni${open ? `<span class="count">${open} sostituzione/i</span>` : ''}</button>
    </div>
    ${thisWeekWorkouts().map((w) => `<div class="card"><span class="pill gold">QUESTA SETTIMANA</span><h3>Allenamento: ${esc(w.published.title)}</h3>
      <p class="small">Vale per tutte le serate della ${esc(weekLabel(w.week_of))}.</p><button style="width:100%" data-act="wOpen" data-id="${w.id}">Apri la scheda</button></div>`).join('')}
    ${homeAvailBanner()}
    <div class="card"><h3>Il tuo prossimo turno</h3>
      ${next.length ? next.map(({ activity: a, assignment: s }) => `<div class="item"><span class="tag">${esc(KIND[a.kind])}</span>
        <p><b>${esc(human(a.date))}</b>${a.start_time ? ' · ' + hhmm(a.start_time) : ''}<br>
        <span class="muted">Con: ${esc(a.assignments.filter((x) => x.id !== s.id).map((x) => staffName(x.profile_id)).join(', ') || 'nessun altro assegnato')}</span></p>
        ${respStatus(s.id)}</div>`).join('') : '<p class="muted">Nessun turno in programma.</p>'}
    </div>
    <div class="rolebar">
      ${isAdmin() ? '<button data-act="go" data-view="plan">Pianifica turni</button><button class="alt" data-act="go" data-view="admin">Gestione Club</button>' : ''}
      ${canAttendance() ? '<button class="alt" data-act="go" data-view="attendance">Registro presenze</button>' : ''}
      ${canWorkouts() ? '<button class="alt" data-act="go" data-view="work">✎ Carica o rivedi un allenamento</button>' : ''}
      <button class="ghost" data-act="password">Cambia password</button>
      <button class="ghost" data-act="logout">Esci da questo telefono</button>
    </div>`;
}

function respStatus(assignmentId) {
  const r = responseOf(assignmentId);
  return `<p class="status">${r === 'ci_sono' ? '<b class="resp-yes">✓ Hai indicato «Ci sono»</b>' : r === 'non_ci_sono' ? '<b class="resp-no">✕ Hai segnalato «Non ci sono»</b>' : 'Non hai ancora risposto (non significa assenza)'}</p>`;
}

function respondButtons(assignmentId) {
  const r = responseOf(assignmentId);
  return `<div class="row"><button class="ok ${r === 'ci_sono' ? 'on' : ''}" data-act="respond" data-id="${assignmentId}" data-r="ci_sono">✓ Ci sono</button>
    <button class="warn ${r === 'non_ci_sono' ? 'on' : ''}" data-act="respond" data-id="${assignmentId}" data-r="non_ci_sono">✕ Non ci sono</button></div>`;
}

// ======================= I MIEI TURNI =======================
function shiftCard({ activity: a, assignment: s }, withButtons) {
  const req = (S.data.requests || []).find((r) => r.assignment_id === s.id && r.status === 'aperta');
  const others = a.assignments.filter((x) => x.id !== s.id).map((x) => staffName(x.profile_id));
  const att = S.data.my_attendance?.[a.id];
  return `<div class="card shift"><span class="pill">${esc(KIND[a.kind])}</span>${a.provisional ? ' <span class="pill gold">da verificare</span>' : ''}${a.status === 'annullata' ? ' <span class="pill red">annullata</span>' : ''}
    <h3>${esc(human(a.date))}</h3>
    ${a.title || a.start_time ? `<p class="muted">${esc([a.title, a.start_time && 'ore ' + hhmm(a.start_time) + (a.end_time ? '–' + hhmm(a.end_time) : '')].filter(Boolean).join(' · '))}</p>` : ''}
    <p class="muted">Con te: ${esc(others.join(', ') || 'nessun altro assegnato')}</p>
    ${a.notes ? `<p class="small">${esc(a.notes)}</p>` : ''}
    ${workoutLinkHtml(a)}
    ${respStatus(s.id)}
    ${att ? `<p class="small">Registro presenze: <b>${att === 'presente' ? 'presente ✓' : 'assente'}</b></p>` : ''}
    ${req ? '<div class="alert">Richiesta di sostituzione inviata a Mario. Solo lui può modificare il turno.</div>' : ''}
    ${withButtons && a.status === 'attiva' ? respondButtons(s.id) : ''}</div>`;
}

function renderMine(main) {
  const t = todayISO();
  const all = myAssignments();
  const next = all.filter((x) => x.activity.date >= t);
  const past = all.filter((x) => x.activity.date < t).reverse();
  main.innerHTML = `<h2>I miei turni</h2>
    <button class="alt" style="width:100%;margin-bottom:8px" data-act="availOpen">Le mie disponibilità (mese per mese)</button>
    <div class="row"><button data-act="printMine">Stampa / Salva PDF</button></div>
    <p class="muted">Turni assegnati da Mario. Rispondi «Ci sono» o «Non ci sono»: se non puoi, Mario organizza la sostituzione.</p>
    ${next.length ? next.map((x) => shiftCard(x, true)).join('') : '<div class="card">Nessun turno in programma.</div>'}
    ${past.length ? `<details><summary>Turni passati (${past.length})</summary>${past.map((x) => shiftCard(x, false)).join('')}</details>` : ''}
    ${backBtn()}`;
}

A.respond = (el) => {
  const r = el.dataset.r;
  if (r === 'non_ci_sono' && !confirm('Confermi «Non ci sono»? Mario riceverà una richiesta di sostituzione.')) return;
  act(() => rpc('respond_assignment', { p_assignment: el.dataset.id, p_response: r }),
    r === 'ci_sono' ? 'Grazie! Hai confermato «Ci sono»' : 'Segnalazione inviata a Mario', { button: el })
    .then(() => { if (sheetOpen() && selectedDay) openDay(selectedDay); });
};

A.printMine = () => {
  const t = todayISO();
  const rows = myAssignments().filter((x) => x.activity.date >= t);
  printHtml(printHeader(`I miei turni · ${S.me.display_name}`, 'Le conferme dall\'app non certificano la presenza effettiva') +
    (rows.length ? `<table><thead><tr><th>Data</th><th>Attività</th><th>Con</th><th>La mia risposta</th></tr></thead><tbody>${rows.map(({ activity: a, assignment: s }) => {
      const r = responseOf(s.id);
      return `<tr><td>${esc(human(a.date))}</td><td>${esc(activityLabel(a))}${a.status === 'annullata' ? ' (annullata)' : ''}</td><td>${esc(a.assignments.filter((x) => x.id !== s.id).map((x) => staffName(x.profile_id)).join(', ') || '—')}</td><td>${r === 'ci_sono' ? 'Ci sono' : r === 'non_ci_sono' ? 'Non ci sono' : 'Non comunicata'}</td></tr>`;
    }).join('')}</tbody></table>` : '<p>Nessun turno in programma.</p>'));
};

// ======================= CALENDARIO =======================
function byDate() {
  const m = new Map();
  for (const a of S.data?.activities || []) { if (!m.has(a.date)) m.set(a.date, []); m.get(a.date).push(a); }
  return m;
}

function monthHtml(y, m, map, t) {
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7; const days = new Date(y, m, 0).getDate();
  let h = ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((w) => `<div class="weekday" aria-hidden="true">${w}</div>`).join('');
  for (let i = 0; i < first; i++) h += '<div class="day empty"></div>';
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const acts = map.get(date) || []; const live = acts.filter((a) => a.status === 'attiva');
    const mine = live.some((a) => a.assignments.some((s) => s.profile_id === S.me.id));
    const course = live.some((a) => a.kind === 'corso');
    const allCancelled = acts.length && !live.length;
    const label = mine ? '● Turno' : live.length ? (course ? '• Corso' : '• Staff') : allCancelled ? 'annullato' : '';
    const aria = `${human(date)}${mine ? ', hai un turno' : live.length ? `, ${live.length} attività` : ''}`;
    h += `<button class="day ${live.length ? 'has' : ''} ${mine ? 'mine' : ''} ${course ? 'course' : ''} ${allCancelled ? 'cancel' : ''} ${date === t ? 'today' : ''} ${date < t ? 'past' : ''}" data-act="day" data-date="${date}" aria-label="${esc(aria)}"><b>${d}</b><span class="dot">${label}</span></button>`;
  }
  return `<div class="calendar">${h}</div>`;
}

function calendarMonths() {
  const now = new Date(); const out = [];
  for (let i = -calMonthsBack; i < 12; i++) out.push(addMonths(now, i));
  return out;
}

function renderCalendar(main) {
  const map = byDate(); const t = todayISO(); const nowKey = t.slice(0, 7);
  const minLoaded = S.range.from.slice(0, 7);
  main.innerHTML = `<h2>Calendario staff</h2>
    <div class="row"><button data-act="printCal">Stampa / Salva PDF</button></div>
    <div class="legend"><span><i class="l-mine"></i>I tuoi turni</span><span><i class="l-has"></i>Attività staff</span><span><i class="l-course"></i>Corso</span></div>
    <p class="muted">Scorri verso l'alto per i mesi successivi. Tocca un giorno per vedere attività e persone assegnate.</p>
    <div class="calbar"><button class="alt sm" data-act="calPrev">↑ Mesi precedenti</button><button class="sm" data-act="calToday">Oggi</button></div>
    <div class="monthflow">${calendarMonths().map((d) => {
      const y = d.getFullYear(), m = d.getMonth() + 1, key = `${y}-${String(m).padStart(2, '0')}`;
      return `<section class="monthcard ${key === nowKey ? 'current' : ''}" id="m-${key}"><h3>${esc(monthLabel(y, m))}</h3>${key < minLoaded ? '<p class="small">Mese non caricato.</p>' : monthHtml(y, m, map, t)}</section>`;
    }).join('')}</div>${backBtn()}`;
}

A.calPrev = async () => {
  calMonthsBack += 2;
  const need = iso(addMonths(new Date(), -calMonthsBack));
  if (need < S.range.from) { S.range = { ...S.range, from: need }; await act(async () => {}, null); }
  const y = window.scrollY, h = document.body.scrollHeight; render(); window.scrollTo(0, y + document.body.scrollHeight - h);
};
A.calToday = () => document.querySelector('.monthcard.current')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
A.day = (el) => openDay(el.dataset.date);

export function openDay(date) {
  selectedDay = date;
  const acts = (S.data.activities || []).filter((a) => a.date === date);
  const t = todayISO();
  const html = `<h2 id="sheetTitle" style="margin-top:4px;text-transform:capitalize">${esc(human(date))}</h2>
    ${acts.length ? acts.map((a) => {
      const mine = a.assignments.find((s) => s.profile_id === S.me.id);
      return `<div class="card ${mine ? 'soft' : ''}">
        <span class="pill">${esc(KIND[a.kind])}</span>${a.provisional ? ' <span class="pill gold">da verificare</span>' : ''}${a.status === 'annullata' ? ' <span class="pill red">annullata</span>' : ''}
        ${a.title || a.start_time ? `<h3>${esc([a.title, a.start_time && 'ore ' + hhmm(a.start_time) + (a.end_time ? '–' + hhmm(a.end_time) : '')].filter(Boolean).join(' · '))}</h3>` : ''}
        <p><b>Staff:</b> ${esc(a.assignments.map((s) => staffName(s.profile_id)).join(' · ') || 'da assegnare')}</p>
        ${a.notes ? `<p class="small">${esc(a.notes)}</p>` : ''}
        ${workoutLinkHtml(a)}
        ${mine && a.status === 'attiva' ? `<p><b>Il tuo turno</b></p>${respStatus(mine.id)}${date >= t ? respondButtons(mine.id) : ''}` : ''}
        ${isAdmin() ? dayAdminHtml(a) : ''}
      </div>`;
    }).join('') : '<p class="muted">Nessuna attività inserita per questo giorno.</p>'}
    ${!acts.some((a) => a.assignments.some((s) => s.profile_id === S.me.id)) && !isAdmin() ? '<div class="alert">Non sei assegnato a questa giornata: puoi consultarla, ma solo Mario assegna i turni e registra le presenze effettive.</div>' : ''}
    ${isAdmin() ? dayAdminHtml(null, date) : ''}`;
  openSheet(html);
}

A.printCal = () => {
  const map = byDate(); const t = todayISO();
  const months = calendarMonths().filter((d) => iso(d).slice(0, 7) >= t.slice(0, 7)).slice(0, 6);
  const list = (S.data.activities || []).filter((a) => a.date >= t && a.date <= iso(addMonths(new Date(), 6)));
  printHtml(printHeader(`Calendario staff · ${S.me.display_name}`, 'In evidenza i tuoi turni') +
    months.map((d, i) => `<div class="monthcard ${i ? '' : ''}"><h2 style="text-transform:capitalize">${esc(monthLabel(d.getFullYear(), d.getMonth() + 1))}</h2>${monthHtml(d.getFullYear(), d.getMonth() + 1, map, '')}</div>`).join('') +
    `<h2 class="pagebreak">Elenco attività e staff</h2><table><thead><tr><th>Data</th><th>Attività</th><th>Staff assegnato</th></tr></thead><tbody>${list.map((a) =>
      `<tr><td>${esc(human(a.date))}</td><td>${esc(activityLabel(a))}${a.status === 'annullata' ? ' (annullata)' : ''}</td><td>${esc(a.assignments.map((s) => staffName(s.profile_id)).join(', ') || 'da assegnare')}</td></tr>`).join('')}</tbody></table>`);
};

// ======================= COMUNICAZIONI =======================
// Bacheca semplice: avvisi fissi + sostituzioni aperte. Non sostituisce WhatsApp.
function renderNotices(main) {
  const reqs = openRequests();
  const ann = S.data.announcements || [];
  main.innerHTML = `<h2>Bacheca</h2>
    <p class="muted">Avvisi utili da tenere a portata di mano. Le comunicazioni di tutti i giorni restano su WhatsApp.</p>
    ${ann.length ? ann.map((n) => `<div class="card"><h3>${esc(n.title)}</h3><p style="white-space:pre-line">${esc(n.body)}</p><p class="small">${esc(dt(n.created_at))}</p>
       ${isAdmin() ? `<button class="ghost sm" data-act="annArchive" data-id="${n.id}">Togli dalla bacheca</button>` : ''}</div>`).join('') : '<div class="card muted">Nessun avviso in bacheca.</div>'}
    ${isAdmin() ? `<details class="card"><summary>＋ Aggiungi un avviso</summary>
      <label for="annTitle">Titolo</label><input id="annTitle" maxlength="120" placeholder="es. Piscina chiusa il 8 dicembre">
      <label for="annBody">Testo</label><textarea id="annBody" maxlength="4000"></textarea>
      <button data-act="annPost" style="width:100%">Metti in bacheca</button></details>` : ''}
    ${reqs.length ? `<h3>Sostituzioni da organizzare</h3>${reqs.map((r) => `<div class="card"><span class="pill red">SOSTITUZIONE</span>
        <h3>${esc(human(r.date))}</h3><p>${esc(staffName(r.requested_by))} non c'è per ${esc((KIND[r.kind] || '').toLowerCase())}${r.title ? ' · ' + esc(r.title) : ''}.</p>
        ${isAdmin() ? replacementForm(r) : '<p class="small">Mario organizza la sostituzione. Se puoi aiutare, scrivigli su WhatsApp.</p>'}
      </div>`).join('')}` : ''}
    ${backBtn()}`;
}

A.resolve = (el) => {
  const v = $('rep-' + el.dataset.id)?.value;
  if (!v) return toast('Scegli prima il sostituto', true);
  act(() => rpc('admin_resolve_replacement', { p_request: el.dataset.id, p_replacement: v, p_note: null }), 'Sostituto assegnato', { button: el });
};
A.resolveNone = (el) => {
  const note = prompt('Nota (facoltativa): perché chiudi senza sostituto?') ?? null;
  if (note === null) return;
  act(() => rpc('admin_resolve_replacement', { p_request: el.dataset.id, p_replacement: null, p_note: note || 'Chiusa dal responsabile' }), 'Richiesta chiusa', { button: el });
};
A.annPost = (el) => {
  const title = $('annTitle').value.trim(), body = $('annBody').value.trim();
  if (!title || !body) return toast('Inserisci titolo e testo', true);
  act(() => insertAnnouncement(title, body), 'Avviso in bacheca', { button: el });
};
A.annArchive = (el) => { if (confirm('Togliere questo avviso dalla bacheca?')) act(() => rpc('archive_announcement', { p_id: el.dataset.id }), 'Avviso tolto'); };
const insertAnnouncement = (title, body) => rpc('post_announcement', { p_title: title, p_body: body });

// ======================= GUIDA =======================
const tourSteps = () => [
  ['Benvenuto al Club dei Mari', 'I quattro pulsanti in basso sono sempre a portata di pollice: I miei turni, Allenamenti, Calendario, Comunicazioni (una bacheca di avvisi). La Guida resta in alto a destra.'],
  ['Le tue disponibilità', 'Per prima cosa indica i tuoi impegni: da «I miei turni» → «Le mie disponibilità» scegli il mese e segna le serate in cui ci sei (✓) e quelle in cui non puoi (✕), per lavoro a turni, orari o viaggi. Se sei libero sempre negli stessi giorni usa «Ripeti ogni settimana» (es. tutti i martedì e giovedì, anche fino a fine stagione) e poi correggi solo le eccezioni. Puoi aggiungere una nota, per esempio «il martedì arrivo alle 21:30». Puoi aggiornarle in qualsiasi momento durante l\'anno, mese per mese: Mario le usa per preparare i turni.'],
  ['I tuoi turni', 'Mario assegna i turni. Su ogni tuo turno puoi toccare «Ci sono» o «Non ci sono». Non puoi assegnarti turni da solo né spostarli.'],
  ['Conferma e presenza sono diverse', 'Rispondere nell\'app non è la presenza ufficiale, e non rispondere non vuol dire essere assenti. Il registro cartaceo in piscina resta valido.'],
  ['Sostituzioni', '«Non ci sono» invia una richiesta a Mario, che sceglie il sostituto (anche concordandolo su WhatsApp).'],
  ['Allenamenti', 'In prima pagina trovi l\'allenamento di questa settimana, uguale per tutte le serate. Le schede pubblicate da Fabio e Mario si leggono, si stampano e si salvano in PDF. I contenuti tecnici non vanno modificati. Le schede delle stagioni passate restano nello «Storico allenamenti», dove puoi anche cercare per parola.'],
  ...(isAdmin() ? [['Pianifica turni', 'Dalla pagina iniziale apri «Pianifica turni». La prima volta imposti la stagione: da che giorno a che giorno, in che giorni e a che ora ci sono allenamenti e corsi. Poi, mese per mese, assegni chi segue ogni serata, anche «a tutti i mercoledì» con un tocco.'], ['Gestione Club', 'Staff e accessi, sostituzioni, registro presenze, esportazioni.']] : []),
  ...(isAdmin() ? [['Disponibilità dello staff', 'In «Pianifica turni», dopo aver impostato la stagione, scegli tra «Per singola serata» e «Calendario del mese»: una tabella con lo staff sulle righe e le serate sulle colonne, dove vedi chi è disponibile (sì / no) e assegni o togli con un tocco. Se qualcuno non ha ancora dichiarato le disponibilità, in Gestione Club trovi l\'elenco e il promemoria già scritto da mandare su WhatsApp. L\'app ti avvisa se assegni chi ha detto di non esserci o chi ha allenato il mese prima (mese di scarico, indicazione di buon senso).']] : []),
  ...(canWorkouts() ? [['Caricare un allenamento', 'In «Allenamenti» tocca «Carica PDF». L\'app propone le schede: confrontale con l\'originale, correggi e solo dopo tocca «Approva e pubblica». Ogni scheda vale per una settimana, dal lunedì alla domenica. Tutte le schede restano nello storico: in «Idee dagli anni scorsi» trovi quelle dello stesso periodo delle stagioni passate e con «Riusa» le trasformi in una nuova bozza da adattare.']] : []),
  ['Stampa', 'In Turni, Calendario e Allenamenti trovi «Stampa / Salva PDF»: sul telefono scegli «Salva come PDF» nel menu di stampa.'],
  ['Privacy', 'L\'app conserva solo nome, email, turni, risposte e presenze. Gli altri vedono nome, turni e sostituzioni da organizzare; email, risposte e presenze di tutti solo il responsabile. Dati su server UE; presenze cancellate dopo 12 mesi. Per vedere, correggere o cancellare i tuoi dati: info@clubdeimari.com.'],
];
let tourStep = 0;
function renderTour(main) {
  const st = tourSteps(); tourStep = Math.min(tourStep, st.length - 1);
  main.innerHTML = `<div class="tour"><div class="muted">PASSO ${tourStep + 1} DI ${st.length}</div><h2>${esc(st[tourStep][0])}</h2><p>${esc(st[tourStep][1])}</p>
    <div class="row"><button class="alt" data-act="tourBack" ${tourStep ? '' : 'disabled'}>← Indietro</button><button data-act="tourNext">${tourStep === st.length - 1 ? 'Inizia ✓' : 'Avanti →'}</button></div></div>
    <button class="ghost" style="width:100%" data-act="tourEnd">Salta la guida</button>`;
}
A.tourNext = () => { if (tourStep >= tourSteps().length - 1) return A.tourEnd(); tourStep++; render(); };
A.tourBack = () => { tourStep = Math.max(0, tourStep - 1); render(); };
A.tourEnd = () => { markSeen('tour.v2'); tourStep = 0; route('home'); };

// ======================= AZIONI GENERALI =======================
A.go = (el) => route(el.dataset.view);
A.reload = () => location.reload();
A.password = () => renderChangePassword(false);
A.logout = async () => {
  if (!confirm('Uscire da questo telefono? I dati salvati sul dispositivo verranno cancellati.')) return;
  await signOut(); wipeLocal(); renderLogin('Sei uscito.');
};

function wireEvents() {
  document.querySelectorAll('.bottomnav button').forEach((b) => { const s = b.querySelector('span'); if (s && NAV_ICONS[b.dataset.view]) { s.className = 'ico'; s.innerHTML = NAV_ICONS[b.dataset.view](); } });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]'); if (c) { closeSheet(); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el) A[el.dataset.change]?.(el, e); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
  $('guideBtn').addEventListener('click', () => { tourStep = 0; route('tour'); });
  document.querySelectorAll('.bottomnav button').forEach((b) => b.addEventListener('click', () => route(b.dataset.view)));
  window.addEventListener('popstate', () => { if (S.me) { S.view = location.hash.slice(1) || 'home'; closeSheet(); render(); } });
  window.addEventListener('online', () => { S.online = true; recheck(); renderBanner(); });
  window.addEventListener('offline', () => { S.online = false; renderBanner(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
  setInterval(recheck, 5 * 60 * 1000);
}

// La schermata d'apertura sparisce da sola (CSS); dopo la togliamo dalla pagina
setTimeout(() => document.getElementById('splash')?.remove(), 1700);

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
