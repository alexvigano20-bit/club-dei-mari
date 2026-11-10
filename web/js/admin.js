// Club dei Mari · Gestione Club (solo Mario) e Registro presenze
import { rpc, callFunction } from './api.js';
import { availSummaryHtml, addOptions, confirmRest } from './availability.js';
import {
  $, esc, S, R, A, act, toast, isAdmin, canAttendance, staffName, activeStaff, human, humanShort, dt, hhmm, KIND,
  activityLabel, todayISO, printHtml, printHeader, download, csv, openRequests, closeSheet, availOf,
} from './core.js';

const back = '<button class="alt" style="width:100%;margin-top:16px" data-act="go" data-view="home">⌂ Torna alla pagina iniziale</button>';
const G = { adminData: null, created: null, sheet: null, month: todayISO().slice(0, 7) };
// chi può essere assegnato a un tipo di attività (corsi / allenamenti)
export const canTeach = (p, kind) => kind === 'altro' || (kind === 'corso' ? p.teaches_courses !== false : p.teaches_trainings !== false);
const rolePills = (p) => `${p.is_admin ? '<span class="pill">responsabile</span> ' : ''}${p.teaches_courses !== false ? '<span class="pill">corsi</span> ' : ''}${p.teaches_trainings !== false ? '<span class="pill">allenamenti</span> ' : ''}${p.can_manage_workouts ? '<span class="pill gold">scrive gli allenamenti</span>' : ''}`;
const roleChecks = (pre, p = {}) => `<div class="small" style="margin-top:6px">Cosa segue? (scelta rapida)</div>
  <label class="check"><input type="checkbox" id="${pre}C" ${p.teaches_courses !== false ? 'checked' : ''}> Corsi</label>
  <label class="check"><input type="checkbox" id="${pre}T" ${p.teaches_trainings !== false ? 'checked' : ''}> Allenamenti</label>
  <label class="check"><input type="checkbox" id="${pre}W" ${p.can_manage_workouts ? 'checked' : ''}> Scrive e pubblica gli allenamenti (come Fabio)</label>`;

// ======================= GIORNO (dal calendario) =======================
export function dayAdminHtml(a, date) {
  if (!a) return `<details class="card"><summary>＋ Aggiungi un'attività in questo giorno</summary>${activityForm(null, date)}</details>`;
  const assigned = new Set(a.assignments.map((s) => s.profile_id));
  const free = activeStaff().filter((p) => !assigned.has(p.id) && canTeach(p, a.kind));
  return `<div class="small" style="margin-top:8px"><b>Gestione (solo Mario)</b></div>
    ${a.assignments.map((s) => {
      const r = S.data.responses?.[s.id];
      return `<div class="checkline"><span class="who">${esc(staffName(s.profile_id))}<br><span class="small">${r === 'ci_sono' ? '✓ ha confermato' : r === 'non_ci_sono' ? '✕ non c\'è' : 'nessuna risposta'}</span></span>
        <button class="warn sm" data-act="unassign" data-id="${s.id}" data-name="${esc(staffName(s.profile_id))}">Togli</button></div>`;
    }).join('')}
    ${a.status === 'attiva' ? `<div class="row" style="align-items:center"><select id="as-${a.id}" style="flex:2;margin:6px 0"><option value="">— assegna istruttore —</option>${addOptions(a, free)}</select>
      <button class="sm" data-act="assign" data-id="${a.id}" style="flex:1">Assegna</button></div>` : ''}
    <details><summary>Modifica attività</summary>${activityForm(a, a.date)}</details>
    <button class="${a.status === 'attiva' ? 'warn' : 'ok'} sm" data-act="actStatus" data-id="${a.id}" data-s="${a.status === 'attiva' ? 'annullata' : 'attiva'}">${a.status === 'attiva' ? 'Annulla attività (es. piscina chiusa)' : 'Ripristina attività'}</button>`;
}

function activityForm(a, date) {
  const k = a?.id || 'new-' + date;
  return `<div data-form="${k}">
    <label>Data</label><input type="date" id="f-date-${k}" value="${esc(a?.date || date)}">
    <label>Tipo</label><select id="f-kind-${k}">${Object.entries(KIND).map(([v, l]) => `<option value="${v}" ${a?.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Titolo (facoltativo)</label><input id="f-title-${k}" maxlength="80" value="${esc(a?.title || '')}" placeholder="es. Corso base">
    <div class="row"><div style="flex:1"><label>Inizio</label><input type="time" id="f-start-${k}" value="${esc(hhmm(a?.start_time))}"></div>
      <div style="flex:1"><label>Fine</label><input type="time" id="f-end-${k}" value="${esc(hhmm(a?.end_time))}"></div></div>
    <label>Note</label><input id="f-notes-${k}" maxlength="1000" value="${esc(a?.notes || '')}">
    <label class="check"><input type="checkbox" id="f-prov-${k}" ${a?.provisional ? 'checked' : ''}> Da verificare (provvisoria)</label>
    <button style="width:100%" data-act="saveActivity" data-k="${k}" data-id="${a?.id || ''}">${a ? 'Salva modifiche' : 'Crea attività'}</button></div>`;
}

A.saveActivity = (el) => {
  const k = el.dataset.k, v = (n) => $(`f-${n}-${k}`);
  if (!v('date').value) return toast('Indica la data', true);
  act(() => rpc('admin_save_activity', { p_id: el.dataset.id || null, p_date: v('date').value, p_kind: v('kind').value,
    p_title: v('title').value, p_start: v('start').value || null, p_end: v('end').value || null, p_notes: v('notes').value, p_provisional: v('prov').checked }),
  'Attività salvata', { button: el }).then((ok) => ok && reopenDay(v('date').value));
};
A.assign = (el) => {
  const p = $('as-' + el.dataset.id).value; if (!p) return toast('Scegli l\'istruttore', true);
  const a = S.data.activities.find((x) => x.id === el.dataset.id); const date = a?.date;
  if (!confirmRest(p, a.date, a.kind)) return;
  act(() => rpc('admin_assign', { p_activity: el.dataset.id, p_profile: p }), 'Turno assegnato', { button: el }).then((ok) => ok && reopenDay(date));
};
A.unassign = (el) => {
  if (!confirm(`Togliere ${el.dataset.name} da questo turno? La modifica resta nello storico.`)) return;
  const date = S.data.activities.find((a) => a.assignments.some((s) => s.id === el.dataset.id))?.date;
  act(() => rpc('admin_unassign', { p_assignment: el.dataset.id }), 'Turno rimosso', { button: el }).then((ok) => ok && reopenDay(date));
};
A.actStatus = (el) => {
  if (el.dataset.s === 'annullata' && !confirm('Annullare l\'attività? Le assegnazioni restano nello storico.')) return;
  const date = S.data.activities.find((a) => a.id === el.dataset.id)?.date;
  act(() => rpc('admin_set_activity_status', { p_id: el.dataset.id, p_status: el.dataset.s }), 'Attività aggiornata', { button: el }).then((ok) => ok && reopenDay(date));
};
async function reopenDay(date) { const { openDay } = await import('./app.js'); if (date) openDay(date); }

// ======================= SOSTITUZIONI =======================
export function replacementForm(r) {
  const others = activeStaff().filter((p) => p.id !== r.requested_by);
  const wa = encodeURIComponent(`Ciao, ${human(r.date)} serve un sostituto per ${(KIND[r.kind] || '').toLowerCase()} (al posto di ${staffName(r.requested_by)}). Chi è disponibile?`);
  return `<label for="rep-${r.id}">Sostituto</label><select id="rep-${r.id}"><option value="">— scegli —</option>${others.map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select>
    <div class="row"><button data-act="resolve" data-id="${r.id}">Assegna sostituto</button>
    <a class="btn alt" href="https://wa.me/?text=${wa}" target="_blank" rel="noopener noreferrer">Scrivi su WhatsApp</a></div>
    <button class="ghost sm" data-act="resolveNone" data-id="${r.id}">Chiudi senza sostituto</button>`;
}

// ======================= GESTIONE CLUB =======================
export function renderAdmin(main) {
  if (!isAdmin()) return;
  if (!G.adminData) { main.innerHTML = '<h2>Gestione Club</h2><p class="muted">Caricamento…</p>'; loadAdmin(); return; }
  const emails = G.adminData.emails || {};
  const staff = S.data.staff || [];
  const reqs = openRequests();
  main.innerHTML = `<h2>Gestione Club</h2>
    <p class="muted">Area riservata al responsabile. Ogni modifica è registrata nello storico.</p>

    <div class="card"><h3>🔔 Sostituzioni da gestire (${reqs.length})</h3>
      ${reqs.length ? reqs.map((r) => `<div class="item"><b>${esc(human(r.date))}</b> · ${esc(staffName(r.requested_by))}<br>${replacementForm(r)}</div>`).join('') : '<p class="muted">Nessuna richiesta aperta.</p>'}</div>

    <div class="card"><h3>📅 Calendario</h3>
      <button style="width:100%" data-act="go" data-view="plan">📋 Pianifica i turni del mese</button>
      <p class="muted">Oppure tocca un giorno nel <a href="#calendar" data-act="go" data-view="calendar">Calendario</a> per orari, note o per annullare una serata.</p>
      <details><summary>Crea serate ricorrenti (es. lun/mer/ven)</summary>
        <div class="row"><div style="flex:1"><label>Dal</label><input type="date" id="serFrom"></div><div style="flex:1"><label>Al</label><input type="date" id="serTo"></div></div>
        <label>Giorni</label><div class="row">${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((d, i) => `<label class="check" style="flex:0 0 auto"><input type="checkbox" class="serDay" value="${i + 1}"> ${d}</label>`).join('')}</div>
        <label>Tipo</label><select id="serKind">${Object.entries(KIND).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <label>Titolo (facoltativo)</label><input id="serTitle" maxlength="80">
        <div class="row"><div style="flex:1"><label>Inizio</label><input type="time" id="serStart"></div><div style="flex:1"><label>Fine</label><input type="time" id="serEnd"></div></div>
        <label class="check"><input type="checkbox" id="serProv"> Da verificare (provvisorie)</label>
        <button style="width:100%" data-act="series">Crea le serate</button>
        <p class="small">Le serate già presenti non vengono duplicate. Le assegnazioni restano da fare.</p></details></div>

    <div class="card"><h3>👥 Staff e accessi</h3>
      ${G.created ? `<div class="success"><b>Account creato per ${esc(G.created.name)}.</b><br>Comunica di persona o su WhatsApp:<br>indirizzo dell'app, email <b>${esc(G.created.email)}</b> e password temporanea <b>${esc(G.created.pw)}</b>. Al primo accesso sceglierà la sua.
        <div class="row"><a class="btn alt" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(`Ciao ${G.created.name}, ecco l'accesso all'app dello staff Club dei Mari: ${location.origin + location.pathname}\nEmail: ${G.created.email}\nPassword temporanea: ${G.created.pw}\nAl primo accesso ti chiederà di sceglierne una tua.`)}">Invia su WhatsApp</a><button class="ghost" data-act="clearCreated">Ok, fatto</button></div></div>` : ''}
      ${staff.map((p) => `<div class="checkline"><span class="who"><b>${esc(p.display_name)}</b>${p.active ? '' : ' <span class="pill grey">disattivato</span>'}<br>
          <span class="small">${esc(emails[p.id] || '')}</span><br>
          ${rolePills(p)}</span>
        <button class="alt sm" data-act="staffEdit" data-id="${p.id}">Gestisci</button></div>`).join('')}
      <details><summary>＋ Aggiungi membro dello staff</summary>
        <label for="nName">Nome visualizzato</label><input id="nName" maxlength="60" placeholder="es. Paolo R.">
        <label for="nEmail">Email personale</label><input id="nEmail" type="email" inputmode="email">
        <label for="nPw">Password temporanea</label><div class="row"><input id="nPw" style="flex:2" minlength="8"><button class="alt sm" style="flex:1" data-act="genPw">Genera</button></div>
        ${roleChecks('n')}
        <button style="width:100%" data-act="staffCreate">Crea accesso</button>
        <p class="small">L'account non viene inviato automaticamente: decidi tu quando comunicarlo.</p></details></div>

    <div class="card"><h3>📝 Presenze effettive</h3><p class="muted">Registro separato dalle conferme in app: stampa il foglio da spuntare in piscina e poi riporta le presenze.</p>
      <button style="width:100%" data-act="go" data-view="attendance">Apri il registro presenze</button>
      <p class="small">Le presenze vengono conservate 12 mesi e poi cancellate automaticamente ogni notte. Prima, se ti servono, esporta il CSV.</p>
      <button class="ghost sm" data-act="purgeAttendance">Cancella ora le presenze oltre 12 mesi</button></div>

    <div class="card"><h3>💾 Dati e sicurezza</h3>
      <button class="alt" style="width:100%" data-act="exportAll">↓ Esporta tutti i dati (copia di sicurezza)</button>
      <p class="small">File JSON completo (staff, calendario, turni, risposte, sostituzioni, presenze, allenamenti, storico). I PDF originali restano nell'archivio privato: vedi la procedura di backup.</p>
      <details><summary>Ultime modifiche registrate</summary><div class="audit">${(G.adminData.audit || []).map(auditLine).join('') || '<p class="muted">Nessuna.</p>'}</div></details>
      <details><summary>Passaggio di responsabilità</summary><p class="small">Per affidare l'amministrazione a un'altra persona: apri «Gestisci» sul suo nome e attiva «Responsabile». Poi, se serve, quella persona toglie il ruolo al precedente. Deve restare sempre almeno un responsabile attivo. Non esistono accessi nascosti.</p></details></div>
    ${back}`;
}

async function loadAdmin() {
  try { G.adminData = await rpc('app_admin'); R.render(); } catch (e) { toast(e.message, true); }
}

const TABLES = { assignments: 'Turno', activities: 'Attività', attendance_records: 'Presenza', profiles: 'Staff', replacement_requests: 'Sostituzione',
  availability_responses: 'Risposta', workouts: 'Allenamento', workout_files: 'PDF', announcements: 'Comunicazione', profile_private: 'Contatti' };
function auditLine(l) {
  const n = l.new || {}, o = l.old || {};
  let what = '';
  if (l.table_name === 'assignments') what = `${n.removed_at && !o.removed_at ? 'tolto' : l.action === 'insert' ? 'assegnato' : 'modificato'}: ${staffName(n.profile_id || o.profile_id)}`;
  else if (l.table_name === 'attendance_records') what = `${staffName(n.profile_id || o.profile_id)} → ${n.status || 'da verificare'}`;
  else if (l.table_name === 'profiles') what = `${n.display_name || o.display_name}${o.active !== undefined && n.active !== o.active ? (n.active ? ' riattivato' : ' disattivato') : ''}`;
  else if (l.table_name === 'activities') what = `${n.date || o.date} ${n.kind || ''}${n.status === 'annullata' ? ' (annullata)' : ''}`;
  else if (l.table_name === 'workouts') what = `${n.title || o.title} · ${n.status || ''}`;
  else if (l.table_name === 'availability_responses') what = n.response === 'ci_sono' ? 'Ci sono' : 'Non ci sono';
  else what = l.action;
  return `<div class="item">${esc(dt(l.at))} · <b>${esc(l.actor || 'sistema')}</b> · ${esc(TABLES[l.table_name] || l.table_name)}: ${esc(what)}</div>`;
}

A.clearCreated = () => { G.created = null; R.render(); };
A.genPw = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; const a = crypto.getRandomValues(new Uint32Array(10));
  $('nPw').value = 'Mare-' + Array.from(a, (x) => chars[x % chars.length]).join('');
};
A.staffCreate = (el) => {
  const name = $('nName').value.trim(), email = $('nEmail').value.trim(), pw = $('nPw').value;
  if (!name || !email) return toast('Inserisci nome ed email', true);
  if (pw.length < 8) return toast('La password temporanea deve avere almeno 8 caratteri', true);
  if (!$('nC').checked && !$('nT').checked && !$('nW').checked) return toast('Scegli almeno: corsi, allenamenti o scrive gli allenamenti', true);
  act(async () => {
    await callFunction('admin-users', { action: 'create', email, display_name: name, temp_password: pw,
      can_manage_workouts: $('nW').checked, teaches_courses: $('nC').checked, teaches_trainings: $('nT').checked });
    G.created = { name, email, pw }; G.adminData = null;
  }, 'Account creato', { button: el });
};
A.series = (el) => {
  const days = [...document.querySelectorAll('.serDay:checked')].map((x) => +x.value);
  const f = $('serFrom').value, t = $('serTo').value;
  if (!f || !t || !days.length) return toast('Indica date e almeno un giorno della settimana', true);
  act(() => rpc('admin_create_series', { p_from: f, p_to: t, p_weekdays: days, p_kind: $('serKind').value, p_title: $('serTitle').value || null,
    p_start: $('serStart').value || null, p_end: $('serEnd').value || null, p_provisional: $('serProv').checked }), null, { button: el })
    .then((n) => { if (n !== false) toast(`${n} serate create`); });
};
A.exportAll = (el) => act(async () => {
  const d = await rpc('admin_export_all');
  download(`club-dei-mari-backup-${todayISO()}.json`, JSON.stringify(d, null, 2), 'application/json');
}, 'Esportazione scaricata', { reload: false, button: el });

A.staffEdit = (el) => {
  const p = S.data.staff.find((x) => x.id === el.dataset.id); const self = p.id === S.me.id;
  import('./core.js').then(({ openSheet }) => openSheet(`<h2 id="sheetTitle">${esc(p.display_name)}</h2>
    <p class="small">${esc(G.adminData?.emails?.[p.id] || '')}</p>
    <div class="card"><h3>Permessi</h3>
      <label class="check"><input type="checkbox" id="pA" ${p.is_admin ? 'checked' : ''} ${self ? 'disabled' : ''}> Responsabile (turni, staff, accessi)</label>
      ${roleChecks('p', p)}
      <p class="small">Le presenze effettive le registra solo il responsabile.</p>
      <button style="width:100%" data-act="permSave" data-id="${p.id}">Salva permessi</button></div>
    <div class="card"><h3>Nome</h3><input id="pName" value="${esc(p.display_name)}" maxlength="60"><button class="alt" style="width:100%" data-act="rename" data-id="${p.id}">Rinomina</button></div>
    <div class="card"><h3>Password</h3><p class="small">Se ha dimenticato la password, impostane una temporanea: al prossimo accesso dovrà sceglierne una nuova.</p>
      <input id="pPw" minlength="8" placeholder="Nuova password temporanea"><button class="alt" style="width:100%" data-act="resetPw" data-id="${p.id}">Reimposta password</button></div>
    ${self ? '' : `<div class="card"><h3>Accesso</h3>${p.active
      ? `<p class="small">Disattivando, ${esc(p.display_name)} perde subito l'accesso a turni, calendario, allenamenti, comunicazioni, presenze e PDF su tutti i dispositivi collegati. Lo storico resta. Non è possibile cancellare file già scaricati o screenshot.</p><button class="warn" style="width:100%" data-act="setActive" data-id="${p.id}" data-a="0">Disattiva accesso</button>`
      : `<button class="ok" style="width:100%" data-act="setActive" data-id="${p.id}" data-a="1">Riattiva accesso</button>`}</div>`}`));
};
A.permSave = (el) => act(() => rpc('admin_set_roles', { p_profile: el.dataset.id, p_admin: $('pA').checked, p_workouts: $('pW').checked, p_courses: $('pC').checked, p_trainings: $('pT').checked }),
  'Permessi aggiornati', { button: el }).then((ok) => ok && closeSheet());
A.rename = (el) => act(() => rpc('admin_rename', { p_profile: el.dataset.id, p_name: $('pName').value }), 'Nome aggiornato', { button: el }).then((ok) => ok && closeSheet());
A.resetPw = (el) => {
  const pw = $('pPw').value; if (pw.length < 8) return toast('Almeno 8 caratteri', true);
  act(() => callFunction('admin-users', { action: 'reset_password', profile_id: el.dataset.id, temp_password: pw }), 'Password temporanea impostata: comunicala alla persona', { button: el })
    .then((ok) => ok && closeSheet());
};
A.setActive = (el) => {
  const on = el.dataset.a === '1'; const name = staffName(el.dataset.id);
  if (!on && !confirm(`Disattivare l'accesso di ${name}? Verrà bloccato su tutti i dispositivi.`)) return;
  act(() => callFunction('admin-users', { action: 'set_active', profile_id: el.dataset.id, active: on }), on ? 'Accesso riattivato' : 'Accesso disattivato', { button: el })
    .then((ok) => { if (ok) { G.adminData = null; closeSheet(); R.render(); } });
};

// ======================= REGISTRO PRESENZE =======================
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }; };

export function renderAttendance(main) {
  if (!canAttendance()) return;
  const rows = G.sheet?.month === G.month ? G.sheet.rows : null;
  if (!rows) { loadSheet(); }
  const groups = new Map();
  for (const r of rows || []) { if (!groups.has(r.activity_id)) groups.set(r.activity_id, { ...r, people: [] }); groups.get(r.activity_id).people.push(r); }
  const acts = (S.data.activities || []).filter((a) => a.date.startsWith(G.month));
  for (const a of acts) if (!groups.has(a.id)) groups.set(a.id, { activity_id: a.id, date: a.date, kind: a.kind, title: a.title, activity_status: a.status, people: [] });
  const ordered = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  main.innerHTML = `<h2>Registro presenze</h2>
    <div class="alert small">Le presenze effettive sono diverse dalle conferme in app. «Da verificare» significa che nessuno ha ancora registrato la presenza: non è un'assenza. Conservazione: 12 mesi.</div>
    <label for="attMonth">Mese</label><input type="month" id="attMonth" value="${G.month}" data-change="attMonth">
    <div class="row"><button data-act="printRegister">🖨️ Stampa foglio da spuntare</button><button class="alt" data-act="printVerified">🖨️ Stampa riepilogo</button><button class="alt" data-act="attCsv">↓ CSV per Excel</button></div>
    ${!rows ? '<p class="muted">Caricamento…</p>' : ordered.length ? ordered.map((g) => `<div class="card"><h3>${esc(humanShort(g.date))} · ${esc(KIND[g.kind])}${g.title ? ' · ' + esc(g.title) : ''}${g.activity_status === 'annullata' ? ' <span class="pill red">annullata</span>' : ''}</h3>
      ${g.people.map((p) => `<div class="checkline"><span class="who"><b>${esc(p.display_name)}</b>${p.assigned ? '' : ' <span class="pill gold">non assegnato</span>'}<br>
        <span class="small">Conferma app: ${p.app_response === 'ci_sono' ? 'Ci sono' : p.app_response === 'non_ci_sono' ? 'Non ci sono' : 'nessuna'}${p.recorded_at ? ` · registrata da ${esc(p.recorded_by_name)} il ${esc(dt(p.recorded_at))}` : ''}</span></span>
        ${g.date > todayISO() ? '<span class="small">registrabile dal giorno dell\'attività</span>' : `<span class="seg" role="group" aria-label="Presenza di ${esc(p.display_name)}">
          <button class="${p.attendance === 'presente' ? 'sel-presente' : ''}" data-act="att" data-a="${g.activity_id}" data-p="${p.profile_id}" data-s="presente">Presente</button>
          <button class="${p.attendance === 'assente' ? 'sel-assente' : ''}" data-act="att" data-a="${g.activity_id}" data-p="${p.profile_id}" data-s="assente">Assente</button>
          <button class="${!p.attendance ? 'sel-none' : ''}" data-act="att" data-a="${g.activity_id}" data-p="${p.profile_id}" data-s="">Da verificare</button></span>`}</div>`).join('') || '<p class="small">Nessuno assegnato.</p>'}
      ${g.date > todayISO() ? '' : `<div class="row" style="align-items:center"><select id="add-${g.activity_id}" style="flex:2;margin:6px 0"><option value="">— aggiungi presente non assegnato —</option>${activeStaff().filter((s) => !g.people.some((p) => p.profile_id === s.id)).map((s) => `<option value="${s.id}">${esc(s.display_name)}</option>`).join('')}</select>
        <button class="alt sm" style="flex:1" data-act="attAdd" data-a="${g.activity_id}">Aggiungi</button></div>`}</div>`).join('') : '<div class="card">Nessuna attività in questo mese.</div>'}
    ${back}`;
}

let loadingSheet = false;
async function loadSheet() {
  if (loadingSheet) return; loadingSheet = true;
  try { const { from, to } = monthRange(G.month); const rows = await rpc('attendance_sheet', { p_from: from, p_to: to }); G.sheet = { month: G.month, rows }; R.render(); }
  catch (e) { toast(e.message, true); } finally { loadingSheet = false; }
}
A.attMonth = (el) => { G.month = el.value || G.month; G.sheet = null; R.render(); };
A.att = (el) => {
  const y = window.scrollY;
  act(async () => { await rpc('set_attendance', { p_activity: el.dataset.a, p_profile: el.dataset.p, p_status: el.dataset.s || null, p_note: null }); G.sheet = null; await loadSheet(); },
    'Registro aggiornato', { reload: false, button: el }).then(() => window.scrollTo(0, y));
};
A.attAdd = (el) => {
  const p = $('add-' + el.dataset.a).value; if (!p) return toast('Scegli la persona', true);
  act(async () => { await rpc('set_attendance', { p_activity: el.dataset.a, p_profile: p, p_status: 'presente', p_note: 'Presente senza assegnazione' }); G.sheet = null; await loadSheet(); },
    'Presenza aggiunta', { reload: false, button: el });
};

function sheetGroups() {
  const groups = new Map();
  for (const r of G.sheet?.rows || []) { if (!groups.has(r.activity_id)) groups.set(r.activity_id, { ...r, people: [] }); groups.get(r.activity_id).people.push(r); }
  return [...groups.values()];
}
A.printRegister = () => {
  const label = new Date(G.month + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const gs = sheetGroups();
  printHtml(printHeader(`Registro presenze · ${label}`, 'Spuntare a bordo vasca le presenze effettive') +
    `<table><thead><tr><th>Data</th><th>Attività</th><th>Istruttore</th><th>Presente</th><th>Note / firma</th></tr></thead><tbody>${
      gs.flatMap((g) => [...g.people.filter((p) => p.assigned), { display_name: '', blank: true }, { display_name: '', blank: true }].map((p, i) =>
        `<tr><td>${i ? '' : esc(humanShort(g.date))}</td><td>${i ? '' : esc(KIND[g.kind]) + (g.activity_status === 'annullata' ? ' (annullata)' : '')}</td><td>${esc(p.display_name)}</td><td><span class="box"></span></td><td></td></tr>`)).join('')
    }</tbody></table><p class="meta">Righe vuote per chi è presente senza assegnazione. Le conferme in app non sostituiscono questo registro.</p>`);
};
A.printVerified = () => {
  const label = new Date(G.month + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  printHtml(printHeader(`Riepilogo presenze · ${label}`) + `<table><thead><tr><th>Data</th><th>Attività</th><th>Istruttore</th><th>Conferma app</th><th>Presenza verificata</th></tr></thead><tbody>${
    (G.sheet?.rows || []).map((r) => `<tr><td>${esc(humanShort(r.date))}</td><td>${esc(KIND[r.kind])}</td><td>${esc(r.display_name)}${r.assigned ? '' : ' (non assegnato)'}</td><td>${r.app_response === 'ci_sono' ? 'Ci sono' : r.app_response === 'non_ci_sono' ? 'Non ci sono' : '—'}</td><td><b>${r.attendance || 'da verificare'}</b></td></tr>`).join('')}</tbody></table>`);
};
A.attCsv = () => {
  const rows = [['Data', 'Giorno', 'Attività', 'Titolo', 'Stato attività', 'Istruttore', 'Assegnato', 'Conferma app', 'Presenza verificata', 'Nota', 'Registrata da', 'Registrata il']];
  for (const r of G.sheet?.rows || []) rows.push([r.date, new Date(r.date + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long' }), KIND[r.kind], r.title || '', r.activity_status,
    r.display_name, r.assigned ? 'sì' : 'no', r.app_response === 'ci_sono' ? 'Ci sono' : r.app_response === 'non_ci_sono' ? 'Non ci sono' : 'nessuna',
    r.attendance || 'da verificare', r.note || '', r.recorded_by_name || '', r.recorded_at ? new Date(r.recorded_at).toLocaleString('it-IT') : '']);
  download(`presenze_club_dei_mari_${G.month}.csv`, csv(rows), 'text/csv;charset=utf-8');
};

// ======================= PIANIFICA TURNI (solo Mario) =======================
// Una pagina per mese: tutte le serate in elenco, nomi da aggiungere/togliere
// con un tocco e l'assegnazione rapida «Aldo a tutti i mercoledì del mese».
const DOW = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const P = { month: todayISO().slice(0, 7), person: '', combo: '' };
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const isoDow = (date) => { const d = new Date(date + 'T12:00').getDay(); return d === 0 ? 7 : d; };

export function renderPlan(main) {
  if (!isAdmin()) return;
  const { from, to } = monthRange(P.month);
  const label = new Date(P.month + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const loaded = from >= S.range.from && to <= S.range.to;
  const acts = (S.data.activities || []).filter((a) => a.date >= from && a.date <= to);
  const staff = activeStaff();
  const count = new Map(staff.map((p) => [p.id, 0]));
  for (const a of acts) if (a.status === 'attiva') for (const s of a.assignments) count.set(s.profile_id, (count.get(s.profile_id) || 0) + 1);
  // solo combinazioni giorno+tipo realmente presenti nel mese (es. «mercoledì · allenamento»)
  const combos = [...new Set(acts.filter((a) => a.status === 'attiva').map((a) => `${isoDow(a.date)}|${a.kind}`))]
    .sort((x, y) => x.split('|')[0] - y.split('|')[0] || x.localeCompare(y));
  const season = (S.data.seasons || []).find((x) => x.start_date <= to && x.end_date >= from);
  const qKind = (P.combo || combos[0] || '|allenamento').split('|')[1];
  main.innerHTML = `<h2>Pianifica turni</h2>
    ${season ? `<div class="card soft" style="padding:12px"><b>Stagione ${esc(season.name)}</b> · dal ${esc(humanShort(season.start_date))} al ${esc(humanShort(season.end_date))}<br>
      <span class="small">${esc(slotSummary(season.slots))}</span><br><button class="ghost sm" data-act="seasonEdit" data-id="${season.id}">✎ Modifica la stagione</button></div>`
      : `<div class="card"><h3>1 · Prima imposta la stagione</h3><p>Quando iniziano e finiscono le attività quest'anno, in che giorni e a che ora ci sono allenamenti e corsi. L'app crea le serate; poi assegni gli istruttori mese per mese.</p>
      <button style="width:100%" data-act="seasonEdit">＋ Imposta la stagione</button></div>`}
    <div class="calbar"><button class="alt sm" data-act="planMonth" data-n="-1" aria-label="Mese precedente">‹</button>
      <b style="flex:3;text-align:center;text-transform:capitalize">${esc(label)}</b>
      <button class="alt sm" data-act="planMonth" data-n="1" aria-label="Mese successivo">›</button></div>
    ${!loaded ? '<div class="alert">Mese fuori dal periodo caricato.</div>' : !acts.length ? `<div class="card muted">${season ? 'Nessuna serata in questo mese (fuori stagione o tutte annullate).' : 'Nessuna serata: imposta prima la stagione.'}</div>` : `
    <div class="card soft"><h3>Assegnazione rapida</h3>
      <div class="row" style="align-items:center">
        <select id="qPerson" style="flex:1 1 140px" aria-label="Chi"><option value="">Chi?</option>${staff.filter((p) => canTeach(p, qKind)).map((p) => `<option value="${p.id}" ${P.person === p.id ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select>
        <select id="qCombo" style="flex:1 1 200px" aria-label="Quali serate" data-change="planCombo">${combos.map((c) => { const [d, k] = c.split('|'); return `<option value="${c}" ${P.combo === c ? 'selected' : ''}>a tutti i ${DOW[d]} · ${KIND[k].toLowerCase()}</option>`; }).join('')}</select>
      </div>
      <button style="width:100%" data-act="planWeekday">Assegna per tutto il mese</button>
      <p class="small">Es. «Aldo a tutti i mercoledì»: chi è già assegnato non viene duplicato; le serate annullate sono saltate.</p></div>
    <div class="card"><h3>Turni nel mese per persona</h3><div class="row" style="gap:6px">${staff.map((p) => `<span class="pill ${count.get(p.id) ? '' : 'grey'}">${esc(p.display_name)} · ${count.get(p.id) || 0}</span>`).join('')}</div></div>
    ${availSummaryHtml(P.month, staff)}
    <div class="row"><button class="alt" data-act="planPrint">🖨️ Stampa il piano del mese</button></div>
    ${acts.map((a) => { const assigned = new Set(a.assignments.map((s) => s.profile_id)); return `<div class="card ${a.status === 'annullata' ? 'soft' : ''}" style="padding:12px">
      <b>${esc(humanShort(a.date))}</b> · ${esc(KIND[a.kind])}${a.start_time ? ' · ' + hhmm(a.start_time) : ''}${a.title ? ' · ' + esc(a.title) : ''}${a.status === 'annullata' ? ' <span class="pill red">annullata</span>' : ''}${a.provisional ? ' <span class="pill gold">da verificare</span>' : ''}
      <div class="row" style="gap:6px;margin:8px 0">${a.assignments.map((s) => { const r = S.data.responses?.[s.id];
        return `<button class="alt sm" data-act="planRemove" data-id="${s.id}" data-name="${esc(staffName(s.profile_id))}" aria-label="Togli ${esc(staffName(s.profile_id))}">${r === 'ci_sono' ? '✓ ' : r === 'non_ci_sono' ? '⚠ ' : ''}${esc(staffName(s.profile_id))} ✕</button>`; }).join('') || '<span class="small">nessuno assegnato</span>'}</div>
      ${a.status === 'attiva' ? `<select data-change="planAdd" data-a="${a.id}" aria-label="Aggiungi istruttore" style="margin:0"><option value="">＋ aggiungi…</option>${addOptions(a, staff.filter((p) => !assigned.has(p.id) && canTeach(p, a.kind)))}</select>` : ''}
    </div>`; }).join('')}`}
    <p class="small">✓ ha confermato · ⚠ ha detto «Non ci sono». Per orari, note o annullare una serata tocca il giorno nel Calendario.</p>
    ${back}`;
}

const keepY = (p) => { const y = window.scrollY; return p.then((r) => { window.scrollTo(0, y); return r; }); };
A.planMonth = (el) => { P.month = shiftMonth(P.month, +el.dataset.n); const { from, to } = monthRange(P.month);
  if (from < S.range.from || to > S.range.to) { S.range = { from: from < S.range.from ? from : S.range.from, to: to > S.range.to ? to : S.range.to }; act(async () => {}, null); } else R.render(); window.scrollTo(0, 0); };
A.planAdd = (el) => {
  if (!el.value) return;
  const a = S.data.activities.find((x) => x.id === el.dataset.a);
  const no = availOf(el.value, a.id) === false;
  if ((no && !confirm(`${staffName(el.value)} ha dichiarato che quella sera NON c'è. Assegnarlo comunque?`)) || (!no && !confirmRest(el.value, a.date, a.kind))) { el.value = ''; return; }
  keepY(act(() => rpc('admin_assign', { p_activity: el.dataset.a, p_profile: el.value }), 'Assegnato'));
};
A.planRemove = (el) => { if (!confirm(`Togliere ${el.dataset.name} da questa serata?`)) return; keepY(act(() => rpc('admin_unassign', { p_assignment: el.dataset.id }), 'Tolto', { button: el })); };
A.planCombo = (el) => { P.combo = el.value; P.person = $('qPerson').value; R.render(); };
A.planWeekday = (el) => {
  const p = $('qPerson').value; if (!p) return toast('Scegli la persona', true);
  const [dow, kind] = $('qCombo').value.split('|'); P.person = p; P.combo = $('qCombo').value;
  const { from, to } = monthRange(P.month);
  if (!confirmRest(p, from, kind)) return;
  const skipped = S.data.activities.filter((a) => a.date >= from && a.date <= to && a.kind === kind && a.status === 'attiva'
    && String(new Date(a.date + 'T12:00').getDay() || 7) === dow && availOf(p, a.id) === false).length;
  keepY(act(() => rpc('admin_assign_weekday', { p_profile: p, p_from: from, p_to: to, p_isodow: +dow, p_kind: kind }), null, { button: el }))
    .then((n) => { if (n !== false) toast(`${n ? `${staffName(p)} assegnato a ${n} serate` : 'Nessuna serata nuova da assegnare'}${skipped ? ` (saltate ${skipped} in cui ha detto che non c'è)` : ''}`); });
};
A.planQuickSeries = (el) => {
  const { from, to } = monthRange(P.month);
  act(() => rpc('admin_create_series', { p_from: from, p_to: to, p_weekdays: el.dataset.d.split(',').map(Number), p_kind: el.dataset.k,
    p_title: null, p_start: null, p_end: null, p_provisional: false }), null, { button: el }).then((n) => { if (n !== false) toast(`${n} serate create`); });
};
A.planPrint = () => {
  const { from, to } = monthRange(P.month);
  const label = new Date(P.month + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const acts = (S.data.activities || []).filter((a) => a.date >= from && a.date <= to);
  printHtml(printHeader(`Turni staff · ${label}`) + `<table><thead><tr><th>Data</th><th>Attività</th><th>Staff</th></tr></thead><tbody>${acts.map((a) =>
    `<tr><td>${esc(human(a.date))}</td><td>${esc(activityLabel(a))}${a.status === 'annullata' ? ' (annullata)' : ''}</td><td>${esc(a.assignments.map((s) => staffName(s.profile_id)).join(', ') || '—')}</td></tr>`).join('')}</tbody></table>`);
};

A.purgeAttendance = (el) => {
  if (!confirm('Cancellare ora le presenze più vecchie di 12 mesi? Se ti servono, esporta prima il CSV dei mesi interessati.')) return;
  act(() => rpc('admin_purge_expired_attendance'), null, { button: el, reload: false }).then((n) => { if (n !== false) toast(`${n} presenze scadute cancellate`); });
};


// ======================= STAGIONE =======================
const DOWS = [1, 2, 3, 4, 5, 6, 7];
const DOW_SHORT = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
function slotSummary(slots) {
  const part = (k, label) => {
    const xs = slots.filter((x) => x.kind === k); if (!xs.length) return '';
    const byTime = {}; for (const x of xs) (byTime[`${x.start}–${x.end}`] ||= []).push(x.isodow);
    return `${label}: ` + Object.entries(byTime).map(([t, ds]) => `${ds.sort().map((d) => DOW_SHORT[d]).join(' · ')} ${t}`).join('; ');
  };
  return [part('allenamento', 'Allenamenti'), part('corso', 'Corsi')].filter(Boolean).join(' — ');
}
function defaultSeason() {
  const now = new Date(); const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-06-30`, slots: [] };
}
function kindBlock(k, label, slots) {
  const xs = slots.filter((x) => x.kind === k); const t = xs[0] || {};
  return `<div class="card"><h3>${label}</h3>
    <div class="small">In che giorni?</div>
    <div class="row" style="gap:4px">${DOWS.map((d) => `<label class="check" style="flex:0 0 auto;margin:4px 6px 4px 0"><input type="checkbox" class="s-${k}" value="${d}" ${xs.some((x) => x.isodow === d) ? 'checked' : ''}> ${DOW_SHORT[d]}</label>`).join('')}</div>
    <div class="row"><div style="flex:1"><label>Dalle</label><input type="time" id="s-${k}-start" value="${esc(t.start || (k === 'corso' ? '20:00' : '21:00'))}"></div>
      <div style="flex:1"><label>Alle</label><input type="time" id="s-${k}-end" value="${esc(t.end || (k === 'corso' ? '21:30' : '22:30'))}"></div></div></div>`;
}
A.seasonEdit = (el) => {
  const s = (S.data.seasons || []).find((x) => x.id === el.dataset.id) || defaultSeason();
  import('./core.js').then(({ openSheet }) => openSheet(`<h2 id="sheetTitle">${s.id ? 'Modifica la stagione' : 'Imposta la stagione'}</h2>
    <div class="card"><h3>Quest'anno</h3>
      <label>Nome</label><input id="s-name" maxlength="40" value="${esc(s.name)}">
      <div class="row"><div style="flex:1"><label>Dal</label><input type="date" id="s-start" value="${esc(s.start_date)}"></div>
        <div style="flex:1"><label>Al</label><input type="date" id="s-end" value="${esc(s.end_date)}"></div></div></div>
    ${kindBlock('allenamento', 'Quando ci sono gli allenamenti?', s.slots)}
    ${kindBlock('corso', 'Quando ci sono i corsi?', s.slots)}
    ${s.id ? '<p class="small">Se togli un giorno o cambi un orario, le serate future non più previste vengono tolte; quelle che hanno già istruttori assegnati restano e te le segnalo.</p>' : '<p class="small">Le serate vengono create dal giorno di oggi (o dall\'inizio della stagione) fino alla fine. Festività e chiusure si annullano poi dal Calendario.</p>'}
    <button style="width:100%" data-act="seasonSave" data-id="${s.id || ''}">${s.id ? 'Salva le modifiche' : 'Crea la stagione e le serate'}</button>`));
};
A.seasonSave = (el) => {
  const slots = [];
  for (const k of ['allenamento', 'corso']) {
    const start = $(`s-${k}-start`).value, end = $(`s-${k}-end`).value;
    const days = [...document.querySelectorAll(`.s-${k}:checked`)].map((x) => +x.value);
    if (days.length && !(start && end && start < end)) return toast('Controlla gli orari: «dalle» deve essere prima di «alle»', true);
    for (const d of days) slots.push({ kind: k, isodow: d, start, end });
  }
  const name = $('s-name').value.trim(), from = $('s-start').value, to = $('s-end').value;
  if (!name || !from || !to || to <= from) return toast('Controlla nome e date della stagione', true);
  if (!slots.length) return toast('Scegli almeno un giorno di allenamento o di corso', true);
  act(async () => {
    const r = await rpc('admin_save_season', { p_id: el.dataset.id || null, p_name: name, p_start: from, p_end: to, p_slots: slots });
    S.range = { from: from < S.range.from ? from : S.range.from, to: to > S.range.to ? to : S.range.to };
    return r;
  }, null, { button: el }).then((r) => {
    if (!r || r === true) return;
    closeSheet();
    toast(`Stagione salvata: ${r.created} serate create${r.adopted ? `, ${r.adopted} già presenti aggiornate con l'orario` : ''}${r.removed ? `, ${r.removed} tolte` : ''}${r.kept_with_staff ? `. ${r.kept_with_staff} serate non più previste hanno istruttori assegnati: controllale nel Calendario` : ''}`);
  });
};
