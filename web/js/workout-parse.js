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

// Unisce le righe spezzate dall'impaginazione (a capo automatico del PDF), con le regole
// stabilite dal club guardando le schede sistemate a mano:
// - «+ 15m recupero LENTO…» (riga che inizia con «+») continua l'esercizio sopra;
// - «…+» seguito da «25m DYN…» è una nuova ripetizione: resta su una riga sua;
// - «+ 2min recupero al muro» è un recupero: resta su una riga sua;
// - una riga che arriva al margine destro a metà frase («senza fermarsi al» / «bordo») si unisce.
const RE_REP = /^\d+(?:[.,]\d+)?\s*m\s+(?:dyn|dnf|snorkel|nuoto)/i;
const RE_REST = /^(?:\+\s*)?\d+\s*min\s+recupero|^recupero completo|^recupero\s*\(?\d/i;
export function joinWrapped(lines) {
  const out = [];
  for (const raw of lines) {
    const o = typeof raw === 'string' ? { text: raw, wraps: false } : raw;
    const line = cleanLine(o.text);
    if (!line) { out.push({ text: '', joined: false, wraps: false }); continue; }
    const prev = out.length ? out[out.length - 1] : null;
    const structural = RE_WORKOUT.test(line) || RE_CONTEXT.test(line) || RE_STANDALONE.test(line) || /^ritorno\s*:/i.test(line);
    const restLine = /^\+/.test(line) && RE_REST.test(line);
    const plusCue = prev && prev.text && !restLine && ((/^\+/.test(line)) || (/\+$/.test(prev.text) && !RE_REP.test(line)));
    const marginCue = prev && prev.text && !RE_ITEM.test(line) && !RE_REST.test(line) && ((prev.wraps && !/[).;:]$/.test(prev.text)) || (/,$/.test(prev.text) && /^[a-zà-ù]/.test(line)));
    if (!structural && (plusCue || marginCue)) {
      prev.text = `${prev.text} ${line}`; prev.joined = prev.joined || (marginCue && !plusCue ? 'margin' : 'plus'); prev.wraps = !!o.wraps;
    } else out.push({ text: line, joined: false, wraps: !!o.wraps, afterPlus: !!(prev && prev.text && /\+$/.test(prev.text)), restLine });
  }
  return out;
}

// ---------- impaginazione della scheda (solo forma, mai il contenuto) ----------
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// «50m» -> «50mt» (non tocca «3min»)
export const fmtUnits = (t) => t.replace(/(\d)m(?![a-zA-Zà-ù])/g, '$1mt');
// «1x 40m…» -> «1 x 40mt…»
const fmtReps = (t) => t.replace(/^(\d+)\s*[x×]\s*/i, '$1 x ');
// Righe d'esercizio: «200m 25m DYN…» diventa «200mt totali» + «25mt DYN…»
function itemLines(text) {
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*m\b\s*(.*)$/i);
  if (m && /^[~\d]/.test(m[2])) return { set: true, lines: [`${m[1]}mt totali`, fmtUnits(m[2])] };
  if (m) return { set: false, lines: [`${m[1]}mt\t\t${fmtUnits(m[2])}`] };
  return { set: false, lines: [fmtUnits(fmtReps(text))] };
}

const newBlock = (title = '') => ({ title, body: [], items: 0, closed: false, kind: '', uncertain: false, notes: [], back: [] });
const isTitleLike = (t) => t.length <= 45 && !/,/.test(t);

// Nomi standard proposti per i blocchi senza titolo (da confermare a mano)
function nameBlocks(blocks) {
  const isFine = (b) => b.kind === 'fine';
  const hasDyn = (b) => /\bdyn\b|\bdnf\b/i.test(b.body.join(' '));
  let warm = false, warmApnea = false;
  const lastIdx = (() => { for (let i = blocks.length - 1; i >= 0; i--) if (!isFine(blocks[i])) return i; return -1; })();
  blocks.forEach((b, i) => {
    if (isFine(b)) return;
    let name = '';
    if (!warm && !warmApnea && !hasDyn(b) && /nuoto/i.test(b.body.join(' '))) { name = 'RISCALDAMENTO'; warm = true; if (b.title) { b.title = `${name} ${b.title}`; b.proposed = true; return; } }
    else if (!warmApnea && hasDyn(b) && i <= 2) { name = 'RISCALDAMENTO APNEA'; warmApnea = true; if (b.title) { b.title = `${name} (${b.title})`; b.proposed = true; return; } }
    if (b.title) return;
    const txt = b.body.join(' ');
    if (!name) name = /espira/i.test(txt) ? 'APNEE IN ESPIRAZIONE' : i === lastIdx ? 'APNEA FINALE' : /\+\s*1 respiro/i.test(txt) ? 'APNEE CON 1 RESPIRO' : 'APNEE';
    b.title = name; b.proposed = true;
  });
}

function finishWorkout(w) {
  if (!w) return null;
  const blocks = w.blocks.filter((b) => b.title || b.body.length);
  for (const b of blocks) {
    // la definizione «ritorno: …» va in fondo al blocco, dopo le ripetizioni che la usano
    if (b.back.length) { while (b.body.length && b.body[b.body.length - 1] === '') b.body.pop(); b.body.push('', ...b.back); }
    while (b.body.length && b.body[0] === '') b.body.shift();
  }
  nameBlocks(blocks);
  return {
    title: w.title, header: w.header, summary: w.summary.join('\n'), source_text: w.source.join('\n'),
    blocks: blocks.map((b) => ({
      title: b.title,
      body: b.body.join('\n'),
      uncertain: b.uncertain || !!b.proposed,
      note: [...new Set([...(b.proposed ? ['Nome del blocco proposto dall\'app: confermalo o cambialo'] : []), ...b.notes])].join(' · '),
    })),
  };
}

// Divide il testo in una o più schede (una per «Settimana N») e propone blocchi e impaginazione.
export function parseWorkouts(rawLines, fallbackTitle = 'Allenamento') {
  const lines = joinWrapped(rawLines);
  const workouts = [];
  let w = null, block = null, context = null, month = '';

  const start = (title) => {
    if (w) workouts.push(finishWorkout(w));
    w = { title, header: '', summary: [], blocks: [], source: [] };
    block = null;
  };
  const addBody = (lines2, opts = {}) => {
    if (!block || block.closed || block.kind === 'fine') { block = newBlock(''); w.blocks.push(block); }
    if (block.body.length && (opts.set || !block.items) && block.body[block.body.length - 1] !== '') block.body.push('');
    block.body.push(...lines2); block.items++;
  };

  for (const { text, joined, afterPlus, restLine } of lines) {
    if (!text) continue;
    if (RE_CONTEXT.test(text) && !RE_WORKOUT.test(text)) { context = text; month = text.match(new RegExp(MONTHS, 'i'))[0]; continue; }
    if (RE_WORKOUT.test(text)) {
      const own = text.match(new RegExp(`^(${MONTHS})`, 'i'));
      if (own) month = own[0];
      const num = text.match(/settimana\s+(\d+)/i)[1];
      start(month ? `${cap(month.toLowerCase())} - Settimana ${num}` : cap(text));
      w.header = context ? `${context.split(':')[0]}\n${text}` : text;
      w.source.push(text);
      if (context) { w.source.unshift(context); const theme = context.split(':').slice(1).join(':').trim(); if (theme) w.summary.push(cap(theme)); context = null; }
      continue;
    }
    if (!w) start(fallbackTitle);
    w.source.push(text);
    const note = joined === 'margin' ? 'Contiene righe unite automaticamente: verifica gli a capo' : '';

    if (/^scarico\b/i.test(text)) { block = newBlock('FINE'); block.kind = 'fine'; block.body.push(cap(fmtUnits(text))); w.blocks.push(block); continue; }
    if (RE_REST.test(text) && w.blocks.length) {
      if (!block) { block = newBlock(''); w.blocks.push(block); }
      block.body.push('', cap(fmtUnits(text))); block.closed = !/^\+/.test(text); continue;
    }
    if (/^ritorno\s*:/i.test(text) && block && !block.closed) { block.back.push(fmtUnits(text)); continue; }
    if (RE_ITEM.test(text)) {
      const it = itemLines(text);
      if (afterPlus && block && !block.closed) block.body.push(fmtUnits(fmtReps(text))); else addBody(it.lines, it);
      if (note) { block.uncertain = true; block.notes.push(note); }
      continue;
    }
    // Riga descrittiva (istruzione, modalità, avvertenza)
    if (!w.blocks.length && !block && (RE_SUMMARY.test(text) || !/:$/.test(text))) { w.summary.push(cap(fmtUnits(text))); continue; }
    if (!block || block.items > 0 || block.closed || block.kind === 'fine') { block = newBlock(''); w.blocks.push(block); }
    if (!block.title && !block.body.length && isTitleLike(text)) block.title = text;
    else if (/^ritorno\s*:/i.test(text)) block.back.push(fmtUnits(text));
    else block.body.push(cap(fmtUnits(text)));
    if (note) { block.uncertain = true; block.notes.push(note); }
  }
  if (w) workouts.push(finishWorkout(w));
  return workouts.filter(Boolean);
}

// Riconduce un testo a parole e numeri confrontabili (ignora spazi e punteggiatura)
export function tokens(text) {
  return cleanLine(String(text).replace(/\n/g, ' ').replace(/(\d)mt\b/gi, '$1m').replace(/\b(\d+)\s+x\s+/gi, '$1x ')).toLowerCase()
    .replace(/[“”«»"'’`]/g, ' ').split(/[\s;:!?()[\]{}·–—]+|(?<!\d)[.,]|[.,](?!\d)/).map((t) => t.trim()).filter(Boolean);
}

// Parole che l'impaginazione aggiunge (nomi dei blocchi, «totali», «settimana»): non sono differenze di contenuto
const LAYOUT_WORDS = new Set(['totali', 'riscaldamento', 'apnea', 'apnee', 'in', 'con', 'respiro', 'espirazione', 'finale', 'fine', '1', '-', 'settimana', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']);
function counts(arr) { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m; }

// Confronta originale e scheda: parole/numeri mancanti o aggiunti.
export function integrity(sourceText, workout) {
  const src = counts(tokens(sourceText));
  const out = counts(tokens([workout.header ?? '', workout.summary, ...workout.blocks.flatMap((b) => [b.title, b.body])].join('\n')));
  const missing = [], extra = [];
  for (const [t, n] of src) { const k = out.get(t) || 0; if (k < n) missing.push(...Array(n - k).fill(t)); }
  for (const [t, n] of out) { const k = src.get(t) || 0; if (k < n && !LAYOUT_WORDS.has(t)) extra.push(...Array(n - k).fill(t)); }
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
