// Scarica tutti i PDF dell'archivio privato in backup/<data>/pdf/ (stessa struttura di cartelle).
// Uso: SUPABASE_URL=https://<ref>.supabase.co SERVICE_ROLE_KEY=... node scripts/backup-storage.mjs [cartella]
// La service role key è un SEGRETO: usala solo dal tuo computer, mai nell'app o nel repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SERVICE_ROLE_KEY, BUCKET = process.env.BUCKET || 'workout-pdfs';
if (!URL_ || !KEY) { console.error('Imposta SUPABASE_URL e SERVICE_ROLE_KEY'); process.exit(1); }
const OUT = process.argv[2] || `backup/${new Date().toISOString().slice(0, 10)}/pdf`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: H, body: JSON.stringify({ prefix, limit: 100, offset }) });
    if (!r.ok) throw new Error(`Elenco fallito: ${r.status} ${await r.text()}`);
    const items = await r.json(); if (!items.length) break;
    for (const it of items) { const p = prefix ? `${prefix}/${it.name}` : it.name; if (it.id) out.push(p); else out.push(...(await list(p))); }
    if (items.length < 100) break;
  }
  return out;
}
const files = await list('');
let n = 0;
for (const p of files) {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`, { headers: H });
  if (!r.ok) { console.error('ERRORE', p, r.status); continue; }
  const dest = join(OUT, p); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, Buffer.from(await r.arrayBuffer())); n++;
}
console.log(`${n}/${files.length} PDF salvati in ${OUT}`);
if (n !== files.length) process.exit(1);
