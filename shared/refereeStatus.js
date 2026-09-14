// Stato di un arbitro in una stagione. Sostituisce il vecchio booleano
// attivo/inattivo: solo "attivo" rende l'arbitro designabile, gli altri due
// stati lo tengono in anagrafica ma fuori dalle liste operative.
// Importato sia dal server (validazione, export) sia dal client (form, filtri).

export const REFEREE_STATUS_OPTIONS = [
  { value: 'attivo', label: 'Attivo', tone: 'final' },
  { value: 'aspettativa', label: 'Aspettativa', tone: 'warning' },
  { value: 'dimissioni', label: 'Dimissioni', tone: 'neutral' }
];

export const REFEREE_STATUSES = REFEREE_STATUS_OPTIONS.map((option) => option.value);

export const DEFAULT_REFEREE_STATUS = 'attivo';

export function isRefereeStatus(value) {
  return REFEREE_STATUSES.includes(String(value || '').trim());
}

// Accetta lo stato testuale e, per retrocompatibilità, il vecchio booleano.
export function normalizeRefereeStatus(value, fallback = DEFAULT_REFEREE_STATUS) {
  const clean = String(value ?? '').trim().toLowerCase();
  if (isRefereeStatus(clean)) return clean;
  if (value === true || clean === 'true' || clean === '1') return 'attivo';
  if (value === false || clean === 'false' || clean === '0') return 'dimissioni';
  return fallback;
}

export function refereeStatusLabel(value) {
  return REFEREE_STATUS_OPTIONS.find((option) => option.value === value)?.label || 'Attivo';
}

export function refereeStatusTone(value) {
  return REFEREE_STATUS_OPTIONS.find((option) => option.value === value)?.tone || 'final';
}

// Solo gli arbitri attivi restano designabili: il flag `active` in tabella
// resta la copia booleana usata da tutte le query storiche.
export function isActiveStatus(value) {
  return normalizeRefereeStatus(value) === 'attivo';
}
