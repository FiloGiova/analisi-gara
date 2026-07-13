export function formatMatchNumber(value, fallback = '—') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) return text;
  return text.replace(/^0+(?=\d)/, '');
}
