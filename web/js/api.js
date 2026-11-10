// Club dei Mari · client minimo per Supabase (Auth, RPC, Storage, Functions)
// Nessuna libreria esterna: solo fetch. Le autorizzazioni vere sono nel database.
import { CONFIG } from './config.js';

const SESSION_KEY = 'cdm.session.v1';
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
let refreshing = null;

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', offline = false } = {}) {
    super(message); this.status = status; this.code = code; this.offline = offline;
  }
}

const base = () => CONFIG.supabaseUrl.replace(/\/$/, '');
const saveSession = (s) => {
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {}
};
export const hasSession = () => !!session?.access_token;
export const sessionUserId = () => session?.user_id || null;

function normalizeSession(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user_id: d.user?.id || session?.user_id,
  };
}

function translateAuthError(msg = '', status) {
  const m = msg.toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid_credentials') || m.includes('invalid grant')) return 'Email o password non corretti.';
  if (m.includes('banned')) return 'Il tuo accesso è stato disattivato dal responsabile del club.';
  if (m.includes('rate') || status === 429) return 'Troppi tentativi. Attendi qualche minuto e riprova.';
  if (m.includes('password') && m.includes('should')) return 'La password non rispetta i requisiti (almeno 8 caratteri).';
  return msg || 'Errore di accesso.';
}

async function rawFetch(url, opts) {
  if (!navigator.onLine) throw new ApiError('Sei offline. Collegati a internet e riprova.', { offline: true });
  try { return await fetch(url, opts); }
  catch { throw new ApiError('Impossibile raggiungere il server. Controlla la connessione e riprova.', { offline: true }); }
}

async function authCall(path, body, method = 'POST', withUser = false) {
  const headers = { apikey: CONFIG.anonKey, 'Content-Type': 'application/json' };
  if (withUser) headers.Authorization = `Bearer ${await accessToken()}`;
  const r = await rawFetch(`${base()}/auth/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new ApiError(translateAuthError(data?.msg || data?.message || data?.error_description || data?.error_code, r.status), { status: r.status, code: data?.error_code || '' });
  return data;
}

export async function signIn(email, password) {
  const d = await authCall('token?grant_type=password', { email: email.trim().toLowerCase(), password });
  saveSession(normalizeSession(d));
}

async function refresh() {
  if (!session?.refresh_token) throw new ApiError('Sessione scaduta: accedi di nuovo.', { status: 401, code: 'no_session' });
  if (!refreshing) {
    refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((d) => saveSession(normalizeSession(d)))
      .catch((e) => { if (!e.offline) saveSession(null); throw e; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function accessToken() {
  if (!session) throw new ApiError('Accedi per continuare.', { status: 401, code: 'no_session' });
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session.access_token;
}

export async function changePassword(newPassword) {
  await authCall('user', { password: newPassword }, 'PUT', true);
}

export async function signOut() {
  try { if (session) await authCall('logout', null, 'POST', true); } catch {}
  saveSession(null);
}
export const forgetSession = () => saveSession(null);

async function authedFetch(url, opts = {}, retry = true) {
  const token = await accessToken();
  const headers = { apikey: CONFIG.anonKey, Authorization: `Bearer ${token}`, ...(opts.headers || {}) };
  const r = await rawFetch(url, { ...opts, headers });
  if (r.status === 401 && retry) { await refresh(); return authedFetch(url, opts, false); }
  return r;
}

async function parse(r) {
  const text = await r.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = data?.message || data?.error || data?.msg || `Errore ${r.status}`;
    const friendly = data?.code === '42501' ? 'Operazione non consentita per il tuo profilo.' : msg;
    throw new ApiError(friendly, { status: r.status, code: data?.code || '' });
  }
  return data;
}

export async function rpc(fn, args = {}) {
  const r = await authedFetch(`${base()}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  return parse(r);
}

export async function callFunction(name, body) {
  const r = await authedFetch(`${base()}/functions/v1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return parse(r);
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export async function uploadPdf(bucket, path, file) {
  const r = await authedFetch(`${base()}/storage/v1/object/${bucket}/${encPath(path)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false', 'cache-control': 'no-store' }, body: file,
  });
  return parse(r);
}

// Link firmato a scadenza breve: il documento non ha mai un URL pubblico permanente
export async function signedUrl(bucket, path, seconds = 60) {
  const r = await authedFetch(`${base()}/storage/v1/object/sign/${bucket}/${encPath(path)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }),
  });
  const d = await parse(r);
  const u = d.signedURL || d.signedUrl;
  return u.startsWith('http') ? u : `${base()}/storage/v1${u.startsWith('/') ? '' : '/'}${u}`;
}
