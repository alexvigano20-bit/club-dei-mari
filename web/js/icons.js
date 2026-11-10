// Club dei Mari · icone dei menu, disegnate nei colori del club
// (blu del marchio, azzurro dell'acqua, arancio/giallo del sole del logo).
// SVG inline: nessun file esterno, nitide su ogni schermo, funzionano offline.

const MESI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
let uid = 0;
const id = (n) => `${n}${++uid}`;

// I miei turni: maschera da apnea
export function iconMine() {
  const g = id('lens');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe6ff"/><stop offset="1" stop-color="#4f9fe0"/></linearGradient></defs>
    <path d="M7 31c-3-1-4-6-1-9" fill="none" stroke="#2e5aa8" stroke-width="4" stroke-linecap="round"/>
    <path d="M57 31c3-1 4-6 1-9" fill="none" stroke="#2e5aa8" stroke-width="4" stroke-linecap="round"/>
    <rect x="7" y="18" width="50" height="27" rx="12.5" fill="#0d4a8f"/>
    <rect x="11.5" y="22.5" width="18.5" height="17" rx="7" fill="url(#${g})"/>
    <rect x="34" y="22.5" width="18.5" height="17" rx="7" fill="url(#${g})"/>
    <path d="M26 41c2 7 10 7 12 0z" fill="#0d4a8f"/>
    <path d="M15 27.5l6-2.2M38 27.5l6-2.2" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>
    <circle cx="50" cy="14" r="3.2" fill="#f1c94a"/><circle cx="56" cy="9" r="2" fill="#e8a23a"/>
  </svg>`;
}

// Allenamenti: apneista in discesa con monopinna, come nel logo
export function iconWork() {
  const g = id('sea');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0fa"/><stop offset="1" stop-color="#0d4a8f"/></linearGradient></defs>
    <circle cx="32" cy="32" r="29" fill="url(#${g})"/>
    <path d="M4 20c5-3.5 9 3.5 14 0s9-3.5 14 0 9 3.5 14 0 9-3.5 14 0" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>
    <g transform="rotate(40 32 32)">
      <path d="M2 23.5l11.5 6v5L2 40.5l4-8.5z" fill="#f1c94a"/>
      <path d="M13 29.4C22 28.3 30.5 26.4 40 26.7c3.4.1 3.4 10.5 0 10.6-9.5.3-18-1.6-27-2.7z" fill="#fff"/>
      <circle cx="46.2" cy="32" r="5.1" fill="#fff"/>
      <path d="M41 27.6l18.8 2.6c1.8.3 1.8 3.4 0 3.6L41 32.3z" fill="#fff"/>
    </g>
    <circle cx="20" cy="45" r="2.4" fill="#fff" opacity=".85"/><circle cx="15" cy="50.5" r="1.7" fill="#fff" opacity=".7"/><circle cx="21" cy="53" r="1.2" fill="#fff" opacity=".6"/>
  </svg>`;
}

// Calendario: mese e giorno di oggi
export function iconCal(date = new Date()) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect x="7" y="10" width="50" height="47" rx="9" fill="#fff" stroke="#d6e0f0" stroke-width="2"/>
    <path d="M7 19a9 9 0 0 1 9-9h32a9 9 0 0 1 9 9v6H7z" fill="#d03a33"/>
    <rect x="18" y="5" width="5" height="11" rx="2.5" fill="#0d4a8f"/><rect x="41" y="5" width="5" height="11" rx="2.5" fill="#0d4a8f"/>
    <text x="32" y="22.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="9.5" font-weight="800" fill="#fff" letter-spacing="1">${MESI[date.getMonth()]}</text>
    <text x="32" y="50" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="24" font-weight="800" fill="#0d4a8f">${date.getDate()}</text>
  </svg>`;
}

// Comunicazioni (bacheca): boa di segnalazione con bandiera sub
export function iconNotices() {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M32 31V7" stroke="#0d4a8f" stroke-width="3" stroke-linecap="round"/>
    <rect x="32" y="7" width="19" height="13" rx="1.5" fill="#d03a33"/>
    <path d="M33 8l17 11" stroke="#fff" stroke-width="3"/>
    <ellipse cx="32" cy="38" rx="17" ry="10.5" fill="#e8a23a"/>
    <path d="M15.5 36.5h33" stroke="#fff" stroke-width="4"/>
    <ellipse cx="27" cy="33" rx="6" ry="2.4" fill="#fff" opacity=".45"/>
    <path d="M4 50c5-4 9 4 14 0s9-4 14 0 9 4 14 0 9-4 14 0" fill="none" stroke="#2e5aa8" stroke-width="4" stroke-linecap="round"/>
    <path d="M10 57c5-3 9 3 14 0s9-3 14 0 9 3 14 0" fill="none" stroke="#7cc4f5" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

export const NAV_ICONS = { mine: iconMine, work: iconWork, calendar: () => iconCal(), notices: iconNotices };
