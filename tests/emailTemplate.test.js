import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  EMAIL_TEMPLATE_PLACEHOLDERS,
  renderEmailTemplate,
  unknownPlaceholders
} from '../src/services/emailTemplate.js';

test('render: sostituisce i segnaposto, anche con spazi interni', () => {
  const rendered = renderEmailTemplate('Caro {{nomeArbitro}}, gara {{ numeroGara }} — {{firma}}', {
    nomeArbitro: 'Luca Bianchi',
    numeroGara: '000901',
    firma: 'Formatori DR1'
  });
  assert.equal(rendered, 'Caro Luca Bianchi, gara 000901 — Formatori DR1');
});

test('render: un segnaposto senza valore resta letterale', () => {
  assert.equal(renderEmailTemplate('Ciao {{nomeArbitro}}', {}), 'Ciao {{nomeArbitro}}');
});

test('il template di default usa solo segnaposto noti e li copre tutti', () => {
  assert.deepEqual(unknownPlaceholders(DEFAULT_EMAIL_BODY_TEMPLATE), []);
  const values = Object.fromEntries(EMAIL_TEMPLATE_PLACEHOLDERS.map((key) => [key, `<${key}>`]));
  const rendered = renderEmailTemplate(DEFAULT_EMAIL_BODY_TEMPLATE, values);
  assert.ok(!rendered.includes('{{'), 'nessun segnaposto deve restare nel default renderizzato');
});

test('unknownPlaceholders individua i segnaposto non previsti', () => {
  assert.deepEqual(unknownPlaceholders('{{nomeArbitro}} {{votoSegreto}} {{altroCampo}}'), [
    'votoSegreto',
    'altroCampo'
  ]);
});
