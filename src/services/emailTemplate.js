// Template del corpo email dei rapporti: funzioni pure, testabili senza database.

export const EMAIL_TEMPLATE_KEY = 'report_email_body_template';

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  'nomeArbitro',
  'numeroGara',
  'campionato',
  'dataGara',
  'squadre',
  'ruolo',
  'firma'
];

export const DEFAULT_EMAIL_BODY_TEMPLATE = [
  'Caro {{nomeArbitro}},',
  '',
  'ecco il rapporto di valutazione della gara in oggetto',
  '(n. {{numeroGara}} · {{campionato}} · {{squadre}} del {{dataGara}}).',
  'Ruolo: {{ruolo}}.',
  '',
  'A presto,',
  '{{firma}}'
].join('\n');

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderEmailTemplate(template, values = {}) {
  return String(template || '').replace(PLACEHOLDER_RE, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match
  );
}

// Segnaposto presenti nel template ma non previsti: da rifiutare al salvataggio.
export function unknownPlaceholders(template) {
  const unknown = new Set();
  for (const match of String(template || '').matchAll(PLACEHOLDER_RE)) {
    if (!EMAIL_TEMPLATE_PLACEHOLDERS.includes(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}
