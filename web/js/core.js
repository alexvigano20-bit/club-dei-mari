// Club dei Mari · stato condiviso e utilità dell'interfaccia
import { rpc, ApiError, forgetSession } from './api.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Collegamenti opzionali (impostati da app.js): es. registro degli errori
export const hooks = { onActError: null };

export const S = {
  me: null,            // profilo dal server (whoami)
  data: null,          // risultato di app_state
  workouts: null,      // risultato di app_workouts
  view: 'home',
  range: null,         // {from,to} caricato
  online: navigator.onLine,
  fromCache: false,
  cacheTime: null,
  scroll: {},
};
export const R = { render: () => {} };   // impostata da app.js

// ---------- Date (fuso orario del dispositivo, pensato per l'Italia) ----------
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => iso(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const human = (s) => parseISO(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const humanShort = (s) => parseISO(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
export const monthLabel = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
export const dt = (ts) => ts ? new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const hhmm = (t) => t ? String(t).slice(0, 5) : '';

export const KIND = { allenamento: 'Allenamento', corso: 'Corso', altro: 'Attività' };
export const activityLabel = (a) => `${KIND[a.kind] || a.kind}${a.title ? ' · ' + a.title : ''}${a.start_time ? ' · ' + hhmm(a.start_time) : ''}`;

// ---------- Permessi (solo per mostrare/nascondere: il server decide) ----------
export const isAdmin = () => !!S.me?.is_admin;
export const canWorkouts = () => !!(S.me?.is_admin || S.me?.can_manage_workouts);
export const canAttendance = () => !!S.me?.is_admin;   // decisione di Mario: presenze solo al responsabile

export const staffName = (id) => S.data?.staff?.find((p) => p.id === id)?.display_name || 'Ex membro';
export const activeStaff = () => (S.data?.staff || []).filter((p) => p.active);

export const myAssignments = () => {
  const out = [];
  for (const a of S.data?.activities || []) for (const s of a.assignments) if (s.profile_id === S.me?.id) out.push({ activity: a, assignment: s });
  return out;
};
export const responseOf = (assignmentId) => S.data?.responses?.[assignmentId] || null;
export const openRequests = () => (S.data?.requests || []).filter((r) => r.status === 'aperta');

// ---------- Messaggi ----------
let toastTimer;
export function toast(msg, isErr = false) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('err', isErr); t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 6000 : 3200);
}

// Esegue un'azione che modifica dati: niente azioni offline, errori sempre visibili,
// dati ricaricati dal server dopo ogni scrittura (nessuna perdita silenziosa).
export async function act(fn, okMsg, { reload = true, button } = {}) {
  if (!navigator.onLine) { toast('Sei offline: la modifica non è stata salvata. Riprova quando sei collegato.', true); return false; }
  if (button) button.disabled = true;
  try {
    const r = await fn();
    if (reload) await loadState();
    if (okMsg) toast(okMsg);
    R.render();
    return r ?? true;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Errore imprevisto: ' + e.message, true);
    try { hooks.onActError?.(`azione non riuscita: ${e?.message || e}`); } catch {}
    if (e?.status === 401) R.render();
    return false;
  } finally { if (button) button.disabled = false; }
}

// ---------- Cache minima per la consultazione offline ----------
// Solo turni/calendario visibili all'utente e schede pubblicate; mai dati di gestione.
const CACHE_KEY = 'cdm.cache.v1';
export function saveCache() {
  try {
    if (!S.me) return;
    const workouts = (S.workouts || []).filter((w) => w.status === 'pubblicato').map((w) => ({ ...w, files: [] }));
    localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: S.me.id, at: Date.now(), me: S.me, data: S.data, workouts, range: S.range }));
  } catch {}
}
export function readCache(uid) {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && c.uid === uid ? c : null; } catch { return null; }
}
export function wipeLocal() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
  forgetSession();
  S.me = null; S.data = null; S.workouts = null;
  if ('caches' in window) caches.keys().then((k) => k.forEach((n) => n.startsWith('cdm-data') && caches.delete(n))).catch(() => {});
}

export function defaultRange() {
  const now = new Date();
  return { from: iso(addMonths(now, -3)), to: iso(new Date(now.getFullYear(), now.getMonth() + 13, 0, 12)) };
}

export async function loadState() {
  S.range = S.range || defaultRange();
  const [data, workouts, avail] = await Promise.all([rpc('app_state', { p_from: S.range.from, p_to: S.range.to }), rpc('app_workouts'),
    rpc('app_availability', { p_from: S.range.from, p_to: S.range.to })]);
  if (!data?.me) { const e = new ApiError('Il tuo accesso è stato disattivato.', { status: 403, code: 'revoked' }); throw e; }
  data.avail = avail || { items: [], notes: [] };
  S.me = data.me; S.data = data; S.workouts = workouts; S.fromCache = false; S.cacheTime = Date.now();
  saveCache();
}

// ---------- Stampa / Salva PDF ----------
export function printHtml(html) {
  const area = $('printArea'); area.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(() => { if (!matchMedia('print').matches) {/* iOS: afterprint può mancare */} }, 500); }, 50);
}
export const printHeader = (title, sub = '') =>
  `<h1>Club dei Mari · ${esc(title)}</h1><div class="meta">${esc(sub)}${sub ? ' · ' : ''}Stampato il ${new Date().toLocaleDateString('it-IT')} da ${esc(S.me?.display_name || '')}</div>`;

export function download(filename, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// CSV per Excel in italiano: UTF-8 con BOM, separatore «;»
export function csv(rows) {
  return '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

// ---------- Foglio di dettaglio ----------
export function openSheet(html) {
  $('sheetBody').innerHTML = html; $('sheet').classList.remove('hidden'); document.body.classList.add('noscroll');
}
export function closeSheet() { $('sheet').classList.add('hidden'); document.body.classList.remove('noscroll'); $('sheetBody').innerHTML = ''; }
export const sheetOpen = () => !$('sheet').classList.contains('hidden');

// ---------- Azioni (nessun onclick inline: compatibile con la Content-Security-Policy) ----------
// Gli elementi usano data-act="nome" (click) o data-change="nome" (change/input).
export const A = {};

// ---------- Disponibilità dichiarate ----------
// true = c'è, false = non c'è, undefined = non dichiarato
export function availOf(profileId, activityId) {
  const it = (S.data?.avail?.items || []).find((x) => x.p === profileId && x.a === activityId);
  return it ? it.v : undefined;
}
export const availNote = (profileId, ym) => (S.data?.avail?.notes || []).find((n) => n.p === profileId && String(n.m).startsWith(ym))?.note || '';
