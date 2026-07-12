// Funzioni pure per la normalizzazione dei nominativi esterni (FIP, XLSX).
// Nessuna dipendenza: importabili sia dai servizi sia dalle migrazioni.

// Il sito FIP aggiunge la provenienza in coda al nome ("VENTURI JACOPO di
// TORINO (TO)"): il "di" è sempre minuscolo, quindi non confligge con i
// cognomi tipo "DI STEFANO".
const TERRITORY_SUFFIX = /\s+di\s+.+\(\s*[A-Za-z]{2}\s*\)\s*\.?$/;

function stripDiacritics(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function cleanExternalName(raw) {
  return String(raw || '')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TERRITORY_SUFFIX, '')
    .trim();
}

export function nameTokens(value) {
  return stripDiacritics(cleanExternalName(value))
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Chiave stabile e indipendente dall'ordine dei token: "MOLINARI GIORGIO" e
// "Giorgio Molinari" producono la stessa chiave.
export function normalizedNameKey(raw) {
  return nameTokens(raw).sort().join(' ');
}
