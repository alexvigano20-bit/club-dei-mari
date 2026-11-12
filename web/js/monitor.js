// Club dei Mari · controllo di funzionamento
// 1) Registro di utilizzo minimo: apertura dell'app, sezione aperta, errori tecnici e
//    versione. Nessun contenuto inserito dall'utente. Conservato 90 giorni; lo leggono
//    solo gli sviluppatori dal database (nessun utente dell'app, nemmeno il responsabile).
//    Serve unicamente a capire se l'app funziona.
// 2) Aggiornamenti: un'app rimasta aperta sul telefono per giorni scopre che è uscita
//    una versione nuova e si aggiorna (o lo propone se stai scrivendo qualcosa).
import { rpc } from './api.js';
import { $, S, A } from './core.js';

export const APP_VERSION = '2026-11-12-1';

const queue = [];
let timer = null;
const client = () => {
  const ua = navigator.userAgent;
  const dev = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'altro';
  const br = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ' app' : '';
  return `${dev} ${br}${app}`;
};

export function track(kind, view = null, detail = null) {
  if (!S.me || S.fromCache) return;
  if (queue.length >= 60) return;
  queue.push({ kind, view: view && String(view).slice(0, 40), detail: detail && String(detail).slice(0, 300), v: APP_VERSION, client: client() });
  clearTimeout(timer); timer = setTimeout(flush, kind === 'errore' ? 2000 : 15000);
}
export async function flush() {
  if (!queue.length || !navigator.onLine || !S.me) return;
  const batch = queue.splice(0, 30);
  try { await rpc('log_usage', { p_events: batch }); } catch { /* il registro non deve mai disturbare l'uso */ }
  if (queue.length) timer = setTimeout(flush, 3000);
}

let lastErr = '';
function onError(msg) {
  msg = String(msg || 'errore sconosciuto').slice(0, 300);
  if (msg === lastErr) return; lastErr = msg;
  track('errore', S.view, msg);
}

// ---------- versione nuova disponibile ----------
let newVersion = false;
async function checkVersion() {
  if (!navigator.onLine || document.hidden) return;
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (v && v !== APP_VERSION) {
      newVersion = true;
      // nessun modulo aperto né testo in scrittura: aggiorna subito, senza chiedere
      const busy = document.querySelector('.sheet:not(.hidden)') || [...document.querySelectorAll('textarea, input[type=text], input:not([type])')].some((x) => x.value && x === document.activeElement);
      if (!busy && ['home', 'calendar', 'mine', 'notices'].includes(S.view)) { await flush(); location.reload(); return; }
      showUpdateBanner();
    }
  } catch { /* offline o rete lenta: riprova dopo */ }
}
function showUpdateBanner() {
  const b = $('banner');
  b.innerHTML = 'È disponibile un aggiornamento dell\'app. <button class="sm" data-act="appReload">Aggiorna ora</button>';
  b.classList.remove('hidden');
}
A.appReload = async () => { await flush(); location.reload(); };
export const updatePending = () => newVersion;

export function startMonitor() {
  window.addEventListener('error', (e) => onError(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => onError('promise: ' + (e.reason?.message || e.reason)));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else checkVersion(); });
  setInterval(checkVersion, 15 * 60 * 1000);
  setTimeout(checkVersion, 5000);
}
export const trackError = onError;
