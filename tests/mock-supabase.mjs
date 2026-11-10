// Emulatore locale MINIMO delle API Supabase usate dall'app, collegato al
// Postgres locale di test (stesse migrazioni e stesse regole RLS della produzione).
// Serve SOLO per i test automatici: non è un server di produzione.
// Avvio: node tests/mock-supabase.mjs   (API su :54321, app su :8080)
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = join(ROOT, '..', 'web');
const DB = process.env.PGDATABASE || 'cdm_test';
const USERS_FILE = join(ROOT, '.mock-users.json');
const STORE = join(ROOT, '.mock-storage');
const TOKEN_TTL = +(process.env.TOKEN_TTL || 3600);
mkdirSync(STORE, { recursive: true });
const users = existsSync(USERS_FILE) ? JSON.parse(readFileSync(USERS_FILE, 'utf8')) : {};
const saveUsers = () => writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
const refreshTokens = new Map();   // token -> user id
const signed = new Map();          // token -> {path, exp}
export const stats = { rpc: 0 };

function psql(sql) {
  return new Promise((resolve) => {
    execFile('psql', ['-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', sql],
      { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(stderr) || [];
          resolve({ error: { code: m[1] || 'XX000', message: (m[2] || stderr).trim() } });
        } else resolve({ out: stdout.trim() });
      });
  });
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Esegue come ruolo authenticated/anon con l'utente impostato (come PostgREST). Il risultato è la riga che inizia con @@
const asRole = (uid, stmt) => `begin; set local role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', ${q(uid || '')}, true); ${stmt}; commit;`;
const pick = (out) => { const l = out.split('\n').find((x) => x.startsWith('@@')); return l === undefined ? null : l.slice(2); };

let procs = null;
async function loadProcs() {
  const r = await psql(`select json_object_agg(proname, json_build_object('set', proretset, 'void', prorettype = 'void'::regtype)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'`);
  procs = JSON.parse(r.out);
}
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' || typeof x === 'string')) return q(`{${v.map((x) => typeof x === 'string' ? `"${x}"` : x).join(',')}}`);
  if (typeof v === 'object') return `${q(JSON.stringify(v))}::jsonb`;
  return q(v);
}
async function callRpc(uid, fn, args) {
  if (!procs) await loadProcs();
  const p = procs[fn]; if (!p) return { status: 404, body: { code: 'PGRST202', message: `Funzione ${fn} inesistente` } };
  const a = Object.entries(args || {}).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
  const sql = p.set ? `select '@@' || coalesce(json_agg(x)::jsonb,'[]')::text from public.${fn}(${a}) x` : p.void ? `select '@@null' from (select public.${fn}(${a})) x` : `select '@@' || coalesce(to_jsonb(public.${fn}(${a}))::text,'null')`;
  stats.rpc++;
  const r = await psql(asRole(uid, sql));
  if (r.error) return { status: r.error.code === '42501' ? 403 : 400, body: r.error };
  return { status: 200, body: JSON.parse(pick(r.out) ?? 'null') };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function issue(uid) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const rt = randomBytes(16).toString('hex'); refreshTokens.set(rt, uid);
  return { access_token: `${b64({ alg: 'none' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.mock`, token_type: 'bearer', expires_in: TOKEN_TTL, expires_at: exp, refresh_token: rt, user: { id: uid } };
}
function uidFrom(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t || !t.includes('.')) return { uid: null };
  try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')); if (p.exp < Date.now() / 1000) return { expired: true }; return { uid: p.sub }; } catch { return { uid: null }; }
}
async function banned(uid) { const r = await psql(`select coalesce(banned_until > now(), false) from auth.users where id = ${q(uid)}`); return r.out === 't'; }

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upsert, cache-control, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, 'Content-Type': isBuf ? 'application/pdf' : 'application/json', ...headers });
  res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body));
}
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

const api = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x'); const path = url.pathname;
  const raw = await readBody(req); const json = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
  try {
    // ---------- AUTH ----------
    if (path === '/auth/v1/token') {
      const b = json();
      if (url.searchParams.get('grant_type') === 'password') {
        const u = users[(b.email || '').toLowerCase()];
        if (!u || u.password !== b.password) return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (await banned(u.id)) return send(res, 400, { error_code: 'user_banned', msg: 'User is banned' });
        return send(res, 200, issue(u.id));
      }
      const uid = refreshTokens.get(b.refresh_token);
      if (!uid) return send(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(b.refresh_token);
      if (await banned(uid)) return send(res, 400, { error_code: 'user_banned', msg: 'User is banned' });
      return send(res, 200, issue(uid));
    }
    const { uid, expired } = uidFrom(req);
    if (expired) return send(res, 401, { code: 'PGRST303', message: 'JWT expired' });
    if (path === '/auth/v1/user' && req.method === 'PUT') {
      if (!uid) return send(res, 401, { msg: 'no auth' });
      const e = Object.keys(users).find((k) => users[k].id === uid); users[e].password = json().password; saveUsers(); return send(res, 200, { id: uid });
    }
    if (path === '/auth/v1/logout') { for (const [t, u] of refreshTokens) if (u === uid) refreshTokens.delete(t); return send(res, 204); }

    // ---------- RPC ----------
    if (path.startsWith('/rest/v1/rpc/')) { const r = await callRpc(uid, path.slice(13), json()); return send(res, r.status, r.body); }

    // ---------- STORAGE ----------
    let m;
    if ((m = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(path))) {
      const name = decodeURIComponent(m[2]);
      if (req.method === 'GET') {
        const s = signed.get(url.searchParams.get('token'));
        if (!s || s.exp < Date.now() || s.path !== `${m[1]}/${name}`) return send(res, 400, { message: 'Signed URL expired or invalid' });
        return send(res, 200, readFileSync(join(STORE, Buffer.from(s.path).toString('hex'))));
      }
      if (!uid) return send(res, 400, { message: 'Object not found' });
      const r = await psql(asRole(uid, `select '@@' || count(*) from storage.objects where bucket_id=${q(m[1])} and name=${q(name)}`));
      if (r.error || pick(r.out) !== '1') return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      const token = randomBytes(12).toString('hex'); signed.set(token, { path: `${m[1]}/${name}`, exp: Date.now() + (json().expiresIn || 60) * 1000 });
      return send(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` });
    }
    if ((m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path)) && req.method === 'POST') {
      const name = decodeURIComponent(m[2]);
      const b = await psql(`select file_size_limit, allowed_mime_types from storage.buckets where id=${q(m[1])}`);
      const [limit] = b.out.split('|');
      if (raw.length > +limit) return send(res, 413, { message: 'The object exceeded the maximum allowed size' });
      if (req.headers['content-type'] !== 'application/pdf') return send(res, 415, { message: 'mime type not supported' });
      const r = await psql(asRole(uid, `insert into storage.objects(bucket_id, name, metadata) values (${q(m[1])}, ${q(name)}, '{"mimetype":"application/pdf"}')`));
      if (r.error) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      writeFileSync(join(STORE, Buffer.from(`${m[1]}/${name}`).toString('hex')), raw);
      return send(res, 200, { Key: `${m[1]}/${name}` });
    }

    // ---------- FUNZIONE admin-users (stessa logica di supabase/functions/admin-users) ----------
    if (path === '/functions/v1/admin-users') {
      if (!uid) return send(res, 401, { error: 'Accesso richiesto' });
      const me = (await callRpc(uid, 'whoami', {})).body;
      if (!me?.is_admin) return send(res, 403, { error: 'Solo il responsabile può gestire gli accessi' });
      const b = json();
      if (b.action === 'create') {
        const email = String(b.email).toLowerCase();
        if (users[email]) return send(res, 400, { error: 'A user with this email address has already been registered' });
        if (!b.temp_password || b.temp_password.length < 8) return send(res, 400, { error: 'La password temporanea deve avere almeno 8 caratteri' });
        const id = randomUUID(); await psql(`insert into auth.users(id,email) values (${q(id)}, ${q(email)})`);
        const r = await callRpc(uid, 'admin_create_profile2', { p_id: id, p_name: b.display_name, p_email: email, p_workouts: !!b.can_manage_workouts, p_courses: b.teaches_courses !== false, p_trainings: b.teaches_trainings !== false });
        if (r.status !== 200) { await psql(`delete from auth.users where id=${q(id)}`); return send(res, 400, { error: r.body.message }); }
        users[email] = { id, password: b.temp_password }; saveUsers(); return send(res, 200, { ok: true, id });
      }
      if (b.action === 'reset_password') {
        const r = await callRpc(uid, 'admin_require_password_change', { p_profile: b.profile_id }); if (r.status !== 200) return send(res, 400, { error: r.body.message });
        const e = Object.keys(users).find((k) => users[k].id === b.profile_id); users[e].password = b.temp_password; saveUsers(); return send(res, 200, { ok: true });
      }
      if (b.action === 'set_active') {
        const r = await callRpc(uid, 'admin_set_active', { p_profile: b.profile_id, p_active: b.active === true });
        if (r.status !== 200) return send(res, 400, { error: r.body.message });
        await psql(`update auth.users set banned_until = ${b.active === true ? 'null' : "now() + interval '100 years'"} where id=${q(b.profile_id)}`);
        if (b.active !== true) for (const [t, u] of refreshTokens) if (u === b.profile_id) refreshTokens.delete(t);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: 'Azione sconosciuta' });
    }
    send(res, 404, { message: 'not found' });
  } catch (e) { send(res, 500, { message: e.message }); }
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  if (p === '/js/config.js') { // nei test locali l'app parla con l'API simulata
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    return res.end("export const CONFIG = { supabaseUrl: 'http://localhost:54321', anonKey: 'local-dev-anon-key', environment: 'sviluppo', pdfBucket: 'workout-pdfs' };");
  }
  const f = join(WEB, p); if (!f.startsWith(WEB) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(readFileSync(f));
});

api.listen(54321, () => console.log('API simulata su http://localhost:54321'));
web.listen(8080, () => console.log('App su http://localhost:8080'));
