// Club dei Mari · riorganizzazione PRUDENTE del testo di un allenamento.
// Principio: non si inventa, non si riformula, non si cambiano numeri.
// Le righe del PDF vengono solo raggruppate in blocchi; ogni parola del
// documento originale deve ritrovarsi nella scheda (controllo di integrità).

const MONTHS = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
const RE_WORKOUT = new RegExp(`^(?:(?:${MONTHS})\\b[^\\n]{0,20}?[-–:·]\\s*)?settimana\\s+\\d+\\b`, 'i');
const RE_CONTEXT = new RegExp(`^(?:${MONTHS})\\s+\\d{4}\\b`, 'i');
const RE_ITEM = /^(?:\d+(?:[.,]\d+)?\s*m\b|\d+\s*[x×]\s|\d+\s*[x×]$|~\s*\d)/i;
const RE_STANDALONE = /^(?:recupero completo|scarico)\b/i;
const RE_SUMMARY = /^(?:distanza totale|attrezzatura)\b/i;

export function cleanLine(s) {
  return String(s).replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// Unisce le righe spezzate dall'impaginazione (a capo automatico del PDF).
// Una riga è "spezzata" se: termina con «+», la successiva inizia con «+»,
// oppure (solo da PDF) arriva al margine destro e la successiva non è un nuovo esercizio.
// Le righe unite vengono segnalate alla revisione.
export function joinWrapped(lines) {
  const out = [];
  for (const raw of lines) {
    const o = typeof raw === 'string' ? { text: raw, wraps: false } : raw;
    const line = cleanLine(o.text);
    if (!line) { out.push({ text: '', joined: false, wraps: false }); continue; }
    const prev = out.length ? out[out.length - 1] : null;
    const structural = RE_WORKOUT.test(line) || RE_CONTEXT.test(line) || RE_STANDALONE.test(line);
    const plusCue = prev && prev.text && (/\+$/.test(prev.text) || /^\+/.test(line));
    const marginCue = prev && prev.text && prev.wraps && !RE_ITEM.test(line);
    if (!structural && (plusCue || marginCue)) {
      prev.text = `${prev.text} ${line}`; prev.joined = true; prev.wraps = !!o.wraps;
    } else out.push({ text: line, joined: false, wraps: !!o.wraps });
  }
  return out;
}

const newBlock = (title = '') => ({ title, body: [], items: 0, uncertain: false, notes: [] });

function finishWorkout(w) {
  if (!w) return null;
  const blocks = w.blocks.filter((b) => b.title || b.body.length).map((b) => ({
    title: b.title,
    body: b.body.join('\n'),
    uncertain: b.uncertain || !b.title,
    note: [...new Set([...(b.title ? [] : ['Blocco senza titolo nel PDF: aggiungi un titolo se utile']), ...b.notes])].join(' · '),
  }));
  return { title: w.title, header: w.header, summary: w.summary.join('\n'), blocks, source_text: w.source.join('\n') };
}

// Divide il testo in una o più schede (una per «Settimana N») e propone i blocchi.
export function parseWorkouts(rawLines, fallbackTitle = 'Allenamento') {
  const lines = joinWrapped(rawLines);
  const workouts = [];
  let w = null, block = null, context = null;

  const start = (title) => {
    if (w) workouts.push(finishWorkout(w));
    w = { title, header: '', summary: [], blocks: [], source: [] };
    if (context) { w.summary.push(context); w.source.push(context); context = null; }
    block = null;
  };

  for (const { text, joined } of lines) {
    if (!text) continue;
    if (RE_CONTEXT.test(text) && !RE_WORKOUT.test(text)) { context = text; continue; }
    if (RE_WORKOUT.test(text)) {
      const prefix = context ? `${context.split(':')[0].trim()} · ` : '';
      start(prefix + text); w.header = text; w.source.unshift(text); continue;
    }
    if (!w) start(fallbackTitle);
    w.source.push(text);

    if (RE_STANDALONE.test(text)) {
      w.blocks.push(newBlock(text)); block = null; continue;
    }
    if (RE_ITEM.test(text)) {
      if (!block) { block = newBlock(''); w.blocks.push(block); }
      block.body.push(text); block.items++;
      if (joined) { block.uncertain = true; block.notes.push('Contiene righe unite automaticamente: verifica gli a capo'); }
      continue;
    }
    // Riga descrittiva (istruzione, modalità, avvertenza)
    if (!w.blocks.length && !block && (RE_SUMMARY.test(text) || !/:$/.test(text))) { w.summary.push(text); continue; }
    if (!block || block.items > 0) { block = newBlock(text); w.blocks.push(block); }
    else if (!block.title) block.title = text;
    else block.body.push(text);
    if (joined) { block.uncertain = true; block.notes.push('Contiene righe unite automaticamente: verifica gli a capo'); }
  }
  if (w) workouts.push(finishWorkout(w));
  return workouts.filter(Boolean);
}

// Riconduce un testo a parole e numeri confrontabili (ignora spazi e punteggiatura)
export function tokens(text) {
  return cleanLine(String(text).replace(/\n/g, ' ')).toLowerCase()
    .replace(/[“”«»"'’`]/g, ' ').split(/[\s;:!?()[\]{}·–—]+|(?<!\d)[.,]|[.,](?!\d)/).map((t) => t.trim()).filter(Boolean);
}

function counts(arr) { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m; }

// Confronta originale e scheda: parole/numeri mancanti o aggiunti.
export function integrity(sourceText, workout) {
  const src = counts(tokens(sourceText));
  const out = counts(tokens([workout.header ?? '', workout.summary, ...workout.blocks.flatMap((b) => [b.title, b.body])].join('\n')));
  const missing = [], extra = [];
  for (const [t, n] of src) { const k = out.get(t) || 0; if (k < n) missing.push(...Array(n - k).fill(t)); }
  for (const [t, n] of out) { const k = src.get(t) || 0; if (k < n) extra.push(...Array(n - k).fill(t)); }
  return { ok: !missing.length && !extra.length, missing, extra };
}

// Righe ricavate da pdf.js: raggruppa i frammenti per posizione verticale e
// annota se la riga arriva al margine destro (probabile a capo automatico).
export function linesFromTextContent(items) {
  const rows = [];
  for (const it of items) {
    if (!('str' in it) || !it.str) continue;
    const y = Math.round(it.transform[5]); const x = it.transform[4]; const right = x + (it.width || 0);
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) { row = { y, parts: [], right: 0 }; rows.push(row); }
    row.parts.push({ x, s: it.str }); row.right = Math.max(row.right, right);
  }
  rows.sort((a, b) => b.y - a.y);
  const textRows = rows.filter((r) => r.parts.some((p) => p.s.trim()));
  const margin = Math.max(0, ...textRows.map((r) => r.right));
  return textRows.map((r) => ({ text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '), wraps: r.right >= margin - 25 }));
}
