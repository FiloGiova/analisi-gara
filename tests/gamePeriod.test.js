import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  currentMonth,
  currentWeekend,
  formatPeriodLabel,
  gameDateKey,
  isGameInPeriod,
  isValidIsoDate,
  periodFileSegment
} from '../shared/gamePeriod.js';
import { filterGamesForDesignations, designationsFileName } from '../src/services/designationsExportService.js';

const games = [
  { matchNumber: '001', scheduledAt: '2026-10-03T18:00', matchday: 1, competition: 'DR1', sourceName: 'DR1 — Girone A', status: 'scheduled', officials: { observer: { userName: 'Rossi Mario' } } },
  { matchNumber: '002', scheduledAt: '2026-10-04T20:00', matchday: 1, competition: 'DR1', sourceName: 'DR1 — Girone A', status: 'scheduled', officials: {} },
  { matchNumber: '003', scheduledAt: '2026-10-11T18:00', matchday: 2, competition: 'DR1', sourceName: 'DR1 — Girone A', status: 'scheduled', officials: {} },
  { matchNumber: '004', scheduledAt: '2026-10-04T18:00', matchday: 1, competition: 'Serie C', sourceName: 'Serie C', status: 'scheduled', officials: {} },
  { matchNumber: '005', scheduledAt: '2026-10-04T18:00', matchday: 1, competition: 'DR1', sourceName: 'DR1 — Girone A', status: 'cancelled', officials: {} },
  { matchNumber: '006', scheduledAt: '', matchday: null, competition: 'DR1', sourceName: 'DR1 — Girone A', status: 'scheduled', officials: {} }
];

test('isGameInPeriod confronta il giorno, estremi inclusi', () => {
  const game = games[1];
  assert.equal(isGameInPeriod(game, '', ''), true, 'nessun periodo = nessun limite');
  assert.equal(isGameInPeriod(game, '2026-10-04', '2026-10-04'), true, 'stesso giorno incluso');
  assert.equal(isGameInPeriod(game, '2026-10-05', ''), false);
  assert.equal(isGameInPeriod(game, '', '2026-10-03'), false);
  assert.equal(isGameInPeriod(game, '2026-10-01', ''), true);

  // Una gara senza data non finisce dentro nessun intervallo.
  assert.equal(isGameInPeriod(games[5], '2026-10-01', '2026-10-31'), false);
  assert.equal(isGameInPeriod(games[5], '', ''), true);
});

test('gameDateKey isola il giorno dalla data con orario', () => {
  assert.equal(gameDateKey({ scheduledAt: '2026-10-04T20:00' }), '2026-10-04');
  assert.equal(gameDateKey({ scheduledAt: '' }), '');
});

test('i preset di periodo cadono nei giorni giusti', () => {
  // 7 ottobre 2026 è un mercoledì.
  const weekend = currentWeekend('2026-10-07');
  assert.deepEqual(weekend, { from: '2026-10-10', to: '2026-10-11' }, 'sabato e domenica della settimana');

  // Di domenica il weekend è quello che si sta giocando, non il prossimo.
  assert.deepEqual(currentWeekend('2026-10-11'), { from: '2026-10-10', to: '2026-10-11' });

  assert.deepEqual(currentMonth('2026-10-07'), { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(addDays('2026-10-31', 1), '2026-11-01', 'cambio mese');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01', 'cambio anno');
});

test('le etichette del periodo sono leggibili', () => {
  assert.equal(formatPeriodLabel('', ''), 'Tutta la stagione');
  assert.equal(formatPeriodLabel('2026-10-04', '2026-10-04'), '04/10/2026');
  assert.equal(formatPeriodLabel('2026-10-03', '2026-10-04'), '03/10 – 04/10/2026');
  assert.equal(formatPeriodLabel('2026-10-04', '', { today: '2026-10-04' }), 'Da oggi');
  assert.equal(formatPeriodLabel('2026-10-04', '', { today: '2026-10-01' }), 'Dal 04/10/2026');
  assert.equal(formatPeriodLabel('', '2026-10-04'), 'Fino al 04/10/2026');
});

test('isValidIsoDate rifiuta le date impossibili', () => {
  assert.equal(isValidIsoDate('2026-02-28'), true);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('04/10/2026'), false);
  assert.equal(isValidIsoDate(''), false);
});

test('l’export designazioni prende esattamente le gare filtrate', () => {
  const weekend = filterGamesForDesignations(games, { dateFrom: '2026-10-03', dateTo: '2026-10-04' });
  assert.deepEqual(weekend.map((game) => game.matchNumber), ['001', '002', '004'], 'niente annullate, niente altre giornate');

  const withCompetition = filterGamesForDesignations(games, {
    competition: 'DR1',
    dateFrom: '2026-10-03',
    dateTo: '2026-10-04'
  });
  assert.deepEqual(withCompetition.map((game) => game.matchNumber), ['001', '002'], 'il periodo si combina col campionato');

  const byMatchday = filterGamesForDesignations(games, { matchdays: ['2'] });
  assert.deepEqual(byMatchday.map((game) => game.matchNumber), ['003']);

  const onlyAssigned = filterGamesForDesignations(games, { onlyAssigned: true });
  assert.deepEqual(onlyAssigned.map((game) => game.matchNumber), ['001'], 'solo le gare con osservatore');
});

test('il nome del file dichiara filtro e stagione', () => {
  assert.equal(
    designationsFileName({ season: '2026/2027', competition: 'DR1', dateFrom: '2026-10-03', dateTo: '2026-10-04' }),
    'designazioni_DR1_03-10-2026_04-10-2026_2026-2027.xlsx'
  );
  assert.equal(designationsFileName({ season: '2026/2027' }), 'designazioni_2026-2027.xlsx');
  assert.equal(periodFileSegment('', ''), '');
});
