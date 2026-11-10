// Test di estrazione e riorganizzazione sul PDF reale fornito (nessuna rete)
import { getDocument } from '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { parseWorkouts, linesFromTextContent, integrity } from '../web/js/workout-parse.js';
const file = process.argv[2];
const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
let lines = [];
for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); lines.push(...linesFromTextContent((await p.getTextContent()).items), ''); }
const ws = parseWorkouts(lines, 'Allenamento');
let fail = 0;
for (const w of ws) {
  const chk = integrity(w.source_text, w);
  console.log(`\n=== ${w.title}  [${chk.ok ? 'INTEGRITÀ OK' : 'DIFFERENZE: -' + chk.missing.join(',') + ' +' + chk.extra.join(',')}]`);
  if (!chk.ok) fail++;
  if (process.argv[3] === 'v') { console.log('SOMMARIO:', w.summary); w.blocks.forEach((b, i) => console.log(`--[${i + 1}] ${b.title || '(senza titolo)'}${b.uncertain ? ' ⚠ ' + b.note : ''}\n${b.body}`)); }
}
console.log(`\nSchede: ${ws.length} · con differenze: ${fail}`);
process.exit(fail ? 1 : 0);
