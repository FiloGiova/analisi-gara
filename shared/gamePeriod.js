// Periodo (data inizio / data fine) dei filtri gare. La regola vive qui perché
// la usano sia il client (elenco gare, designazioni) sia gli export XLSX: il
// foglio deve contenere esattamente le gare che l'utente stava guardando.

export function todayIso(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Giorno della gara come stringa ISO (le date sono TEXT 'YYYY-MM-DDTHH:MM',
// quindi il confronto lessicografico basta e avanza).
export function gameDateKey(game) {
  const raw = String(game?.scheduledAt || '');
  return raw ? raw.slice(0, 10) : '';
}

export function isGameInPeriod(game, dateFrom = '', dateTo = '') {
  const from = String(dateFrom || '');
  const to = String(dateTo || '');
  if (!from && !to) return true;
  const day = gameDateKey(game);
  // Una gara senza data non appartiene a nessun intervallo: comparirebbe in
  // ogni periodo, che è il contrario di quello che ci si aspetta.
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function isValidIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

// Weekend corrente (sabato e domenica della settimana in corso): il campionato
// gioca quasi solo lì, ed è il periodo che si sceglie più spesso.
export function currentWeekend(today = todayIso()) {
  const [year, month, day] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domenica
  const toSaturday = weekday === 0 ? -1 : 6 - weekday;
  const saturday = addDays(today, toSaturday);
  return { from: saturday, to: addDays(saturday, 1) };
}

export function currentMonth(today = todayIso()) {
  const [year, month] = today.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

function formatDay(iso, { withYear = true } = {}) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
}

// Etichetta compatta del periodo, usata dal chip del filtro, dal riepilogo
// sopra la tabella e dall'intestazione dei fogli XLSX.
export function formatPeriodLabel(from = '', to = '', { today = todayIso() } = {}) {
  if (!from && !to) return 'Tutta la stagione';
  if (from && !to) return from === today ? 'Da oggi' : `Dal ${formatDay(from)}`;
  if (!from && to) return `Fino al ${formatDay(to)}`;
  if (from === to) return formatDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDay(from, { withYear: !sameYear })} – ${formatDay(to)}`;
}

// Versione adatta a un nome file: "04-05ott" oppure "dal-04-10-2026".
export function periodFileSegment(from = '', to = '') {
  if (!from && !to) return '';
  const compact = (iso) => iso.split('-').reverse().join('-');
  if (from && to) return from === to ? compact(from) : `${compact(from)}_${compact(to)}`;
  return from ? `dal-${compact(from)}` : `al-${compact(to)}`;
}
