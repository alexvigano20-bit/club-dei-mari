// Le tre versioni dell'app devono coincidere: altrimenti i telefoni non capiscono che c'è un aggiornamento
import { readFileSync } from 'node:fs';
const v = JSON.parse(readFileSync(new URL('../web/version.json', import.meta.url))).v;
const mon = readFileSync(new URL('../web/js/monitor.js', import.meta.url), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const sw = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8').match(/VERSION = 'cdm-shell-([^']+)'/)[1];
if (v !== mon || v !== sw) { console.error(`Versioni diverse: version.json ${v}, monitor.js ${mon}, sw.js ${sw}`); process.exit(1); }
console.log('Versione coerente:', v);
