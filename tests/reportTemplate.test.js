import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVALUATION_SECTIONS,
  EVALUATION_SECTIONS_V1,
  RATING_OPTIONS,
  REPORT_TEMPLATE_VERSION,
  VOTE_BANDS,
  VOTE_VALUES,
  bandForVote,
  createEmptyReport,
  formatVote,
  matchCharacteristicsForVersion,
  normalizeVoteValue,
  ratingToNumber,
  sectionsForVersion,
  templateVersionOf
} from '../shared/reportTemplate.js';

test('la struttura 2026/2027 ha cinque sezioni e quattordici valutazioni', () => {
  assert.deepEqual(EVALUATION_SECTIONS.map((section) => section.id), ['fitness', 'conduct', 'technique', 'mechanics']);
  const ratings = 1 + EVALUATION_SECTIONS.reduce((total, section) => total + section.groups.length, 0);
  assert.equal(ratings, 14);
  assert.equal(EVALUATION_SECTIONS.find((s) => s.id === 'technique').groups.length, 8);
});

test('la scala ha cinque livelli, con N.V. solo dove il modello lo prevede', () => {
  assert.deepEqual(RATING_OPTIONS.quality, [
    'Migliorabile',
    'Sotto lo standard',
    'Standard',
    'Sopra lo standard',
    'Di qualità'
  ]);
  const technique = EVALUATION_SECTIONS.find((section) => section.id === 'technique');
  const withNotEvaluable = technique.groups.filter((group) => group.options.includes('N.V.')).map((g) => g.id);
  assert.deepEqual(withNotEvaluable, ['flagrantFouls', 'otherSituations']);
});

test('la griglia dei voti copre 7,2-8,8 e ogni voto appartiene a una sola fascia', () => {
  assert.equal(VOTE_VALUES.length, 17);
  assert.equal(VOTE_VALUES[0], '7.2');
  assert.equal(VOTE_VALUES.at(-1), '8.8');
  for (const value of VOTE_VALUES) {
    const bands = VOTE_BANDS.filter((band) => band.votes.includes(value));
    assert.equal(bands.length, 1, `il voto ${value} sta in ${bands.length} fasce`);
  }
  assert.equal(bandForVote('7.4'), 'Migliorabile');
  assert.equal(bandForVote('8,0'), 'Standard');
  assert.equal(bandForVote('8.8'), 'Di qualità');
  assert.equal(bandForVote('9.0'), '');
});

test('il voto si normalizza sulla griglia e si mostra con la virgola', () => {
  assert.equal(normalizeVoteValue('8,0'), '8.0');
  assert.equal(normalizeVoteValue(' 7.5 '), '7.5');
  assert.equal(normalizeVoteValue('8.9'), '');
  assert.equal(normalizeVoteValue('68'), '');
  assert.equal(formatVote('8.0'), '8,0');
  // I voti interi delle stagioni precedenti restano interi.
  assert.equal(formatVote('68'), '68');
  assert.equal(formatVote(''), '');
});

test('le due scale cadono sullo stesso asse 0-4', () => {
  assert.equal(ratingToNumber('Migliorabile'), 0);
  assert.equal(ratingToNumber('Sotto lo standard'), 1);
  assert.equal(ratingToNumber('Standard'), 2);
  assert.equal(ratingToNumber('Sopra lo standard'), 3);
  assert.equal(ratingToNumber('Di qualità'), 4);
  assert.equal(ratingToNumber('Eccellente'), 4);
  assert.equal(ratingToNumber('N.V.'), null);
  assert.equal(ratingToNumber('N/V'), null);
});

test('la versione si legge dal payload, e i rapporti senza campo restano v1', () => {
  assert.equal(templateVersionOf(createEmptyReport()), REPORT_TEMPLATE_VERSION);
  assert.equal(templateVersionOf(createEmptyReport(1)), 1);
  assert.equal(
    templateVersionOf({ evaluations: { first: { sections: { administration: { ratings: {} } } } } }),
    1,
    'le sezioni della vecchia struttura bastano a riconoscerla'
  );
  assert.equal(sectionsForVersion(1), EVALUATION_SECTIONS_V1);
  assert.equal(sectionsForVersion(2), EVALUATION_SECTIONS);
  assert.deepEqual(matchCharacteristicsForVersion(2).groups[0].options, [
    'Facile',
    'Di normale difficoltà',
    'Impegnativa',
    'Difficile'
  ]);
});

test('il rapporto vuoto v1 conserva il giudizio globale, quello v2 i nuovi blocchi', () => {
  const legacy = createEmptyReport(1).evaluations.first;
  assert.equal(legacy.globalJudgement, '');
  assert.ok(!('strengths' in legacy));
  assert.ok(legacy.sections.administration);

  const current = createEmptyReport().evaluations.first;
  assert.equal(current.strengths, '');
  assert.equal(current.improvements, '');
  assert.equal(current.additionalNotes, '');
  assert.equal(current.band, '');
  assert.ok(!('globalJudgement' in current));
});
