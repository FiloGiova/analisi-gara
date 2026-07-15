import test from 'node:test';
import assert from 'node:assert/strict';
import {
  federationTextSimilarity,
  parseFederationPdfBuffer,
  parseFederationReportText
} from '../src/services/federationPdfParser.js';
import { federationReportText as fixture } from './fixtures/federationReportText.js';

test('estrae intestazione e ruolo dal contenuto, senza nome file', () => {
  const parsed = parseFederationReportText(fixture());
  assert.equal(parsed.groupKey, '2025/2026|341');
  assert.equal(parsed.role, 'first');
  assert.equal(parsed.header.observerName, 'VERDI LUCA');
  assert.equal(parsed.header.reportDate, '2025-11-17');
  assert.equal(parsed.header.competition, 'DR1');
  assert.equal(parsed.header.firstRefereeName, 'ROSSI MARIO');
  assert.equal(parsed.header.secondRefereeName, 'BIANCHI ANNA');
});

test('mappa tutte le valutazioni, voto e potenzialità', () => {
  const parsed = parseFederationReportText(fixture({ target: 'BIANCHI ANNA', vote: '66', potential: 'Media' }));
  assert.equal(parsed.role, 'second');
  assert.equal(parsed.matchCharacteristics.ratings.difficulty, 'Normale');
  assert.equal(parsed.evaluation.sections.management.ratings.leadership, 'Di qualità');
  assert.equal(parsed.evaluation.sections.discipline.ratings.measures, 'N/V');
  assert.equal(parsed.evaluation.sections.technique.ratings.contactResponsibility, 'Migliorabile');
  assert.equal(parsed.evaluation.globalJudgement, 'Punti di forza: presenza. Aree di miglioramento: continuità.');
  assert.equal(parsed.evaluation.technicalErrors, 'NO');
  assert.equal(parsed.evaluation.potential.level, 'Media');
  assert.equal(parsed.evaluation.potential.comment, 'Percorso di crescita positivo.');
  assert.equal(parsed.evaluation.vote, '66');
});

test('ricompone le righe grafiche del PDF e misura come equivalenti descrizioni quasi identiche', () => {
  const text = fixture().replace(
    'Tecnica da consolidare.',
    'Tecnica sul body-\ncheck da consolidare.'
  );
  const parsed = parseFederationReportText(text);
  assert.equal(parsed.evaluation.sections.technique.comment, 'Tecnica sul body-check da consolidare.');
  assert.ok(federationTextSimilarity(
    'Gioco che si sviluppa principalmente con tiri da fuori, azioni che si concludono rapidamente, difese aperte e pochi contatti rendono questa partita di normale difficoltà. Cigliano sempre avanti nel punteggio, ospiti a contatto sino ad inizio 4Q quando il distacco si dilata progressivamente.',
    'Gioco che si sviluppa principalmente con tiri da fuori, azioni che si concludono rapidamente, difese aperte e pochi contatti rendono questa partita di normale difficoltà. Cigliano sempre avanti nel punteggio, ospiti sempre a contatto sino ad inizio 4Q quando il distacco si dilata progressivamente.'
  ) >= 0.97);
  assert.ok(federationTextSimilarity(
    'Gara semplice e sempre sotto controllo.',
    'Gara complessa, fisica e con diversi momenti critici.'
  ) < 0.97);
});

test('separa gli errori tecnici dalla potenzialità', () => {
  const parsed = parseFederationReportText(fixture({ errors: 'Passi non rilevati a 2:10 IIQ.' }));
  assert.equal(parsed.evaluation.technicalErrors, 'Passi non rilevati a 2:10 IIQ.');
  assert.equal(parsed.evaluation.potential.level, 'Alta');
  assert.equal(parsed.evaluation.vote, '68');
});

test('accetta il template abbreviato senza potenzialità e voto', () => {
  const parsed = parseFederationReportText(fixture({ includePotentialAndVote: false }));
  assert.equal(parsed.evaluation.globalJudgement, 'Punti di forza: presenza. Aree di miglioramento: continuità.');
  assert.equal(parsed.evaluation.technicalErrors, 'NO');
  assert.equal(parsed.evaluation.potential.level, '');
  assert.equal(parsed.evaluation.potential.comment, '');
  assert.equal(parsed.evaluation.vote, '');
  assert.deepEqual(parsed.fieldAvailability, { potential: false, vote: false });
});

test('rifiuta un arbitro target non presente nei due ruoli', () => {
  assert.throws(
    () => parseFederationReportText(fixture({ target: 'NOME SCONOSCIUTO' })),
    /non coincide in modo univoco/
  );
});

test('rifiuta file senza firma PDF e documenti senza testo', async () => {
  await assert.rejects(() => parseFederationPdfBuffer(Buffer.from('non un pdf')), /non è un PDF valido/);
  assert.throws(() => parseFederationReportText('   '), /non contiene testo selezionabile/);
});
