// Club dei Mari · icone dei menu, disegnate nei colori del club
// Stile: sagome realistiche con chiaroscuro, ispirate all'apneista del logo
// (sagoma blu con contorno bianco). SVG inline: nitide e disponibili offline.

const MESI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
let uid = 0;
const id = (n) => `${n}${++uid}`;

// I miei turni: maschera da apnea a basso volume (lenti a goccia, facciale in silicone, cinghiolo)
export function iconMine() {
  const sk = id('sk'), ln = id('ln'), st = id('st');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${sk}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a64ad"/><stop offset=".55" stop-color="#0d4a8f"/><stop offset="1" stop-color="#082f5c"/></linearGradient>
      <radialGradient id="${ln}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#e9f6ff"/><stop offset=".45" stop-color="#8ccaf3"/><stop offset="1" stop-color="#2f78bf"/></radialGradient>
      <linearGradient id="${st}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3f46"/><stop offset="1" stop-color="#16181c"/></linearGradient>
    </defs>
    <path d="M3 27c2-6 6-7 8-6v9c-3-1-6 0-8-3z" fill="url(#${st})"/>
    <path d="M61 27c-2-6-6-7-8-6v9c3-1 6 0 8-3z" fill="url(#${st})"/>
    <path d="M10 22c4-6 14-7 22-4 8-3 18-2 22 4 3 5 2 13-3 17-4 3-9 3-13 0-2-2-4-3-6-3s-4 1-6 3c-4 3-9 3-13 0-5-4-6-12-3-17z" fill="url(#${sk})"/>
    <path d="M15 24.5c3-3.5 9-4 13-1.5 1.2.8 1.4 2.4.8 3.7l-2.6 6c-1 2.3-3.6 3.3-6 2.5-4.8-1.6-7.4-6.8-5.2-10.7z" fill="url(#${ln})"/>
    <path d="M49 24.5c-3-3.5-9-4-13-1.5-1.2.8-1.4 2.4-.8 3.7l2.6 6c1 2.3 3.6 3.3 6 2.5 4.8-1.6 7.4-6.8 5.2-10.7z" fill="url(#${ln})"/>
    <path d="M17.5 26.5c2-1.6 4.6-2 6.8-1.3M39.7 25.2c2.2-.7 4.8-.3 6.8 1.3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
    <path d="M28.5 37c1.5-1.4 2.6-2 3.5-2s2 .6 3.5 2l-1 4.5c-.6 1.8-4.4 1.8-5 0z" fill="#082f5c"/>
    <path d="M12 22.5c4-5 13-6 20-3.2" stroke="#6fa3dc" stroke-width="1.1" fill="none" opacity=".7"/>
  </svg>`;
}

// Allenamenti: apneista in piscina visto dall'alto, nuoto orizzontale con due pinne lunghe
export function iconWork() {
  const wt = id('wt'), bd = id('bd'), fn = id('fn');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${wt}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ad8fb"/><stop offset="1" stop-color="#3f8fd6"/></linearGradient>
      <linearGradient id="${bd}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a64ad"/><stop offset=".5" stop-color="#0d4a8f"/><stop offset="1" stop-color="#0a3d78"/></linearGradient>
      <linearGradient id="${fn}" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#0d4a8f"/><stop offset="1" stop-color="#3a7bc8"/></linearGradient>
      <clipPath id="${wt}c"><rect x="2" y="6" width="60" height="52" rx="12"/></clipPath>
    </defs>
    <rect x="2" y="6" width="60" height="52" rx="12" fill="url(#${wt})"/>
    <g clip-path="url(#${wt}c)">
      <path d="M8 18c5 1.2 8-1.2 13 0s8 1.2 13 0 8-1.2 13 0 8 1.2 13 0M4 48c5 1.2 8-1.2 13 0s8 1.2 13 0 8-1.2 13 0 8 1.2 13 0" stroke="#fff" stroke-width="1" fill="none" opacity=".4"/>
      <path d="M2 32h52" stroke="#0a3d78" stroke-width="3.2" opacity=".28"/><path d="M54 27v10" stroke="#0a3d78" stroke-width="3.2" opacity=".28"/>
      <g>${[6, 14, 22, 30, 38, 46, 54].map((x, i) => `<circle cx="${x}" cy="11" r="2.6" fill="${i % 2 ? '#fff' : '#d03a33'}"/>`).join('')}</g>
      <g transform="translate(2 20) scale(.6)" stroke="#fff" stroke-width="1.8" stroke-linejoin="round">
        <path d="M30 15L2 9.5Q0 12 1.5 14.5L30 18z" fill="url(#${fn})"/>
        <path d="M30 22L1.5 25.5Q0 28 2 30.5L30 25z" fill="url(#${fn})"/>
        <g fill="url(#${bd})">
          <path d="M52 15.5C44 15.2 36 15.4 30 15.4v3c7 .2 15 .6 22 1.2z"/>
          <path d="M52 20.4c-7 .6-15 1-22 1.2v3c6 0 14 .2 22-.1z"/>
          <path d="M51 14.5c7-1.3 15-2.5 21-2.3 3 .1 4 1.8 4 7.8s-1 7.7-4 7.8c-6 .2-14-1-21-2.3z"/>
          <path d="M74 12.5q14 2.5 25 6.3 1 1.2-.5 1.6Q87 18.5 74 16z"/>
          <path d="M74 27.5q14-2.5 25-6.3 1-1.2-.5-1.6Q87 21.5 74 24z"/>
          <ellipse cx="80" cy="20" rx="4.6" ry="3.9"/>
        </g>
        <path d="M55 16.5c6-1.4 12-2.2 17-2" stroke="#6fa3dc" stroke-width="1.3" fill="none"/>
      </g>
      <circle cx="54.5" cy="25" r="1.3" fill="#fff" opacity=".85"/><circle cx="57" cy="21.5" r=".9" fill="#fff" opacity=".7"/>
    </g>
  </svg>`;
}

// Calendario: foglio con anelli metallici, mese e giorno di oggi
export function iconCal(date = new Date()) {
  const hd = id('hd'), rg = id('rg'), pg = id('pg');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${hd}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2463e"/><stop offset="1" stop-color="#b8302a"/></linearGradient>
      <linearGradient id="${rg}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5b6b80"/><stop offset=".5" stop-color="#dfe6ef"/><stop offset="1" stop-color="#5b6b80"/></linearGradient>
      <linearGradient id="${pg}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef2f8"/></linearGradient>
    </defs>
    <rect x="8" y="12" width="48" height="46" rx="8" fill="#0d4a8f" opacity=".18" transform="translate(1.5 2)"/>
    <rect x="8" y="12" width="48" height="46" rx="8" fill="url(#${pg})" stroke="#cfd9e8" stroke-width="1.2"/>
    <path d="M8 20a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v6H8z" fill="url(#${hd})"/>
    <rect x="18" y="6" width="4.6" height="12" rx="2.3" fill="url(#${rg})"/><rect x="41.4" y="6" width="4.6" height="12" rx="2.3" fill="url(#${rg})"/>
    <text x="32" y="23.6" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="9" font-weight="800" fill="#fff" letter-spacing="1.2">${MESI[date.getMonth()]}</text>
    <text x="32" y="50.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="23" font-weight="800" fill="#0d4a8f">${date.getDate()}</text>
  </svg>`;
}

// Comunicazioni (bacheca): boa di segnalazione con bandiera sub, in acqua
export function iconNotices() {
  const by = id('by'), wa = id('wa'), fl = id('fl');
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="${by}" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffd27a"/><stop offset=".55" stop-color="#e8962e"/><stop offset="1" stop-color="#b8661a"/></radialGradient>
      <linearGradient id="${wa}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb0ea"/><stop offset="1" stop-color="#0d4a8f"/></linearGradient>
      <linearGradient id="${fl}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e2463e"/><stop offset="1" stop-color="#b8302a"/></linearGradient>
    </defs>
    <path d="M31.2 33V6.5" stroke="#3c4654" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M32.2 7c5 1.2 9-1.4 15 .2v12c-6-1.6-10 1-15-.2z" fill="url(#${fl})"/>
    <path d="M32.6 7.6l14.2 11" stroke="#fff" stroke-width="2.6"/>
    <path d="M13 40c0-8 8.5-12 19-12s19 4 19 12c0 3-3 5-6 5H19c-3 0-6-2-6-5z" fill="url(#${by})"/>
    <path d="M13.6 37.5c5-1.6 12-2.3 18.4-2.3s13.4.7 18.4 2.3" stroke="#fff" stroke-width="2.4" fill="none" opacity=".9"/>
    <ellipse cx="25" cy="32" rx="5.5" ry="1.8" fill="#fff" opacity=".45"/>
    <path d="M2 46c5-2.4 9 1.6 15 0s9-2.4 15 0 9 2.4 15 0 10-2.2 15-.4V58a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="url(#${wa})"/>
    <path d="M8 52c4 1.4 7-1.4 11 0M30 54c4 1.4 7-1.4 11 0" stroke="#fff" stroke-width="1" opacity=".45" fill="none"/>
  </svg>`;
}

export const NAV_ICONS = { mine: iconMine, work: iconWork, calendar: () => iconCal(), notices: iconNotices };
