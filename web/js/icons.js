// Club dei Mari · immagini dei menu (fornite dal club), servite dall'app e disponibili offline
const IMG = { mine: 'I miei turni', work: 'Allenamenti', calendar: 'Calendario', notices: 'Comunicazioni' };
const img = (k) => `<img src="./img/menu/${k}.webp" alt="" width="264" height="198" decoding="async">`;

export const iconMine = () => img('mine');
export const iconWork = () => img('work');
export const iconCal = () => img('calendar');
export const iconNotices = () => img('notices');
export const NAV_ICONS = Object.fromEntries(Object.keys(IMG).map((k) => [k, () => img(k)]));
