export function formatMatchNumber(value, fallback = '—') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) return text;
  return text.replace(/^0+(?=\d)/, '');
}

// Data italiana ("gg/mm/aaaa"), uniforme in tutta l'app.
export function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  try {
    return new Date(value).toLocaleDateString('it-IT');
  } catch {
    return String(value);
  }
}

// Data + ora ("gg/mm/aaaa · hh:mm"); l'ora è omessa se assente o 00:00.
export function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  try {
    const date = new Date(value);
    const day = date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = String(value).length > 10
      ? date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '';
    return time && time !== '00:00' ? `${day} · ${time}` : day;
  } catch {
    return String(value);
  }
}

// "oggi" / "ieri" / "N giorni fa"; oltre la settimana, data assoluta.
export function formatRelativeDate(value, fallback = '—') {
  if (!value) return fallback;
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return String(value);
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days > 1 && days < 7) return `${days} giorni fa`;
  return formatDate(value, fallback);
}
