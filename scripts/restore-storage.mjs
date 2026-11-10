// Ricarica i PDF salvati con backup-storage.mjs in un progetto (nuovo o ripristinato).
// Uso: SUPABASE_URL=... SERVICE_ROLE_KEY=... node scripts/restore-storage.mjs backup/AAAA-MM-GG/pdf
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SERVICE_ROLE_KEY, BUCKET = process.env.BUCKET || 'workout-pdfs';
const DIR = process.argv[2]; if (!URL_ || !KEY || !DIR) { console.error('Uso: SUPABASE_URL=... SERVICE_ROLE_KEY=... node scripts/restore-storage.mjs <cartella pdf>'); process.exit(1); }
const walk = (d) => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
let ok = 0; const files = walk(DIR);
for (const f of files) {
  const p = relative(DIR, f).split(/[\\/]/).map(encodeURIComponent).join('/');
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${p}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: readFileSync(f) });
  if (r.ok) ok++; else console.error('ERRORE', p, r.status, await r.text());
}
console.log(`${ok}/${files.length} PDF ricaricati`); if (ok !== files.length) process.exit(1);
