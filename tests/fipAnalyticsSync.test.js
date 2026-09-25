import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId, dbGet, dbRun } = await import('./helpers/testDatabase.js');
const { analyticsFetch, designazione, gara } = await import('./helpers/fipAnalyticsFixture.js');
const { createSource, createAnalyticsSources, runAnalyticsSync, runFipSync, runSourceSync, updateSource } = await import(
  '../src/services/syncService.js'
);
const { getGame, listGames, setOfficial, getOfficialRow } = await import('../src/services/gameService.js');
const { runScheduledAnalyticsSync, getScheduledAnalyticsSyncStatus } = await import('../src/services/scheduledSyncService.js');

await setupTestDatabase();

const credentials = { username: 'designatore@example.invalid', password: 'segreta' };
const state = { calls: [], items: [] };
const fetchImpl = analyticsFetch(state);
const SEASON = '2026/2027';

const rossiId = await insertId('INSERT INTO referees (first_name, last_name, license_number) VALUES (?, ?, ?)', ['Mario', 'Rossi', '53553']);
const verdiId = await insertId('INSERT INTO referees (first_name, last_name, license_number) VALUES (?, ?, ?)', ['Luca', 'Verdi', '60111']);
const observerId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss-analytics', 'x', 'Osservatore Analytics', 'observer')"
);

const rossi = (stato = 'accettata') => designazione({ ruolo: 'ARB_1', cognome: 'ROSSI', nome: 'MARIO', tessera: '053553', stato });
const verdi = (stato = 'accettata') => designazione({ ruolo: 'ARB_2', cognome: 'VERDI', nome: 'LUCA', tessera: '060111', stato });

function calendar({ first = [rossi(), verdi()], second = [] } = {}) {
  return [
    gara({ num: 1101, giornata: 1, casa: 'CASA A', ospite: 'OSPITE A', designazioni: first }),
    gara({ num: 1102, giornata: 1, casa: 'CASA B', ospite: 'OSPITE B', designazioni: second }),
    gara({ num: 1201, giornata: 1, girone: 'Girone B', casa: 'CASA C', ospite: 'OSPITE C' })
  ];
}

async function gameByNumber(matchNumber) {
  return (await listGames({ season: SEASON })).find((game) => game.matchNumber === matchNumber);
}

let gironeA;

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un campionato FIP Analytics crea una sorgente per girone, senza doppioni', async () => {
  state.items = calendar();
  const { sources, skipped } = await createAnalyticsSources(
    { sportSeason: SEASON, name: 'DR1', competition: 'DR1', codCampionato: 'D' },
    { fetchImpl, credentials }
  );
  assert.deepEqual(sources.map((source) => source.name), ['DR1 — Girone A', 'DR1 — Girone B']);
  assert.equal(skipped.length, 0);
  assert.equal(sources[0].sourceType, 'fip_analytics');
  assert.deepEqual(sources[0].params, { cod_campionato: 'D', fase: 'Qualificazione', girone: 'Girone A' });
  gironeA = sources[0];

  await assert.rejects(
    () => createAnalyticsSources({ sportSeason: SEASON, competition: 'DR1', codCampionato: 'D' }, { fetchImpl, credentials }),
    (err) => err.statusCode === 409
  );
  await assert.rejects(
    () => createAnalyticsSources({ sportSeason: SEASON, codCampionato: 'D' }, { fetchImpl, credentials }),
    /campionato della web app/
  );
});

test('la prima sincronizzazione crea le gare del girone e riconosce gli arbitri dalla tessera', async () => {
  state.items = calendar({ second: [designazione({ ruolo: 'ARB_1', cognome: 'SCONOSCIUTO', nome: 'PINCO', tessera: '099999', stato: 'temporanea' })] });
  const result = await runAnalyticsSync(gironeA.id, { fetchImpl, credentials });

  assert.equal(result.created, 2, 'solo le gare del Girone A');
  assert.equal(result.gamesRead, 2);
  const first = await gameByNumber('001101');
  assert.equal(first.competition, 'DR1');
  assert.equal(first.externalSource, 'fip_analytics');
  assert.equal(first.venue, 'PALESTRA TEST, Via Roma 1 10100 TORINO ( TO)');
  assert.equal(first.officials.referee1.refereeId, rossiId, 'tessera 053553 = licenza 53553');
  assert.equal(first.officials.referee2.refereeId, verdiId);
  assert.equal(first.officials.referee1.status, 'confirmed');

  const second = await gameByNumber('001102');
  assert.equal(second.officials.referee1.status, 'provisional', 'la designazione temporanea resta provvisoria');
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].externalName, 'SCONOSCIUTO PINCO');
});

test('la stessa sincronizzazione ripetuta non cambia nulla', async () => {
  const before = (await dbGet('SELECT COUNT(*) AS n FROM game_changes')).n;
  const result = await runAnalyticsSync(gironeA.id, { fetchImpl, credentials });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.officialsUpdated, 0);
  assert.equal((await dbGet('SELECT COUNT(*) AS n FROM game_changes')).n, before);
});

test('da temporanea a trasmessa, revoca e rifiuto aggiornano la designazione', async () => {
  state.items = calendar({ first: [rossi(), verdi('revoca')], second: [designazione({ ruolo: 'ARB_1', cognome: 'SCONOSCIUTO', nome: 'PINCO', tessera: '099999', stato: 'trasmessa' })] });
  const result = await runAnalyticsSync(gironeA.id, { fetchImpl, credentials });

  const first = await gameByNumber('001101');
  assert.equal(first.officials.referee2, undefined, 'la revoca libera il posto');
  const second = await gameByNumber('001102');
  assert.equal(second.officials.referee1.status, 'confirmed');
  assert.equal(result.officialsUpdated, 2);

  const detail = await getGame(first.id);
  assert.ok(detail.changes.some((change) => change.field === 'ufficiale:referee2' && change.source === 'fip_analytics' && !change.newValue));
});

test('osservatore e valori bloccati non vengono mai toccati', async () => {
  const first = await gameByNumber('001101');
  await setOfficial(first.id, { role: 'observer', userId: observerId, source: 'manual' }, {});
  await setOfficial(first.id, { role: 'referee2', refereeId: rossiId, externalName: 'Rossi Mario', source: 'manual', manualLock: true }, {});

  state.items = calendar({ first: [rossi(), verdi()] });
  const result = await runAnalyticsSync(gironeA.id, { fetchImpl, credentials });

  assert.equal(result.status, 'partial');
  assert.ok(result.conflicts.some((conflict) => conflict.matchNumber === '001101' && conflict.field === 'ufficiale:referee2'));
  const after = await getGame(first.id);
  assert.equal(after.officials.observer.userId, observerId);
  const locked = await getOfficialRow(first.id, 'referee2');
  assert.equal(locked.referee_id, rossiId);
  assert.equal(locked.manual_lock, 1);
});

test('una gara del sito pubblico passa a FIP Analytics; il sito pubblico aggiorna poi solo il risultato', async () => {
  const { sources: [publicSource] } = await createSource({
    sportSeason: SEASON,
    name: 'DR1 pubblico',
    url: 'https://fip.it/risultati/?codice_girone=777&codice_fase=1&regione_codice=PI'
  });
  const publicHtml = ({ venue, ref1, score = ['', ''] }) => `<html><body>
    <a href="https://fip.it/risultati/?codice_girone=777&giornata=1">1</a>
    <div class="results-matches__match">
      <div class="teams">
        <div class="team"><div class="team__name">CASA D</div><div class="team__points">${score[0]}</div></div>
        <div class="team"><div class="team__name">OSPITE D</div><div class="team__points">${score[1]}</div></div>
      </div>
      <div class="results-matches__match__info">
        <div class="datetime"><div class="date">3 Ottobre 2026</div><div class="time">18:00</div></div>
        <div class="ref">001103</div>
      </div>
      <div class="results-matches__match__moreinfo">
        <div class="info"><div class="label">Campo di gioco</div><div class="value">${venue}</div></div>
        <div class="info"><div class="label">1° Arbitro</div><div class="value">${ref1}</div></div>
      </div>
    </div></body></html>`;
  let html = publicHtml({ venue: 'VECCHIO CAMPO', ref1: 'VERDI LUCA di TORINO (TO)' });
  const publicFetch = (url) => Promise.resolve({ ok: true, status: 200, url, text: () => Promise.resolve(html) });
  await runFipSync(publicSource.id, { fetchImpl: publicFetch });
  const imported = await gameByNumber('001103');
  assert.equal(imported.competitionSourceId, publicSource.id);

  // FIP Analytics conosce la stessa gara con un altro arbitro.
  state.items = [...calendar({ first: [rossi(), verdi()] }), gara({ num: 1103, giornata: 1, casa: 'CASA D', ospite: 'OSPITE D', designazioni: [rossi()] })];
  await runAnalyticsSync(gironeA.id, { fetchImpl, credentials });
  const owned = await getGame(imported.id);
  assert.equal(owned.competitionSourceId, gironeA.id, 'la gara passa alla sorgente FIP Analytics');
  assert.equal(owned.venue, 'PALESTRA TEST, Via Roma 1 10100 TORINO ( TO)');
  assert.equal(owned.officials.referee1.refereeId, rossiId);
  assert.equal(owned.officials.referee1.source, 'fip_analytics');
  assert.ok(owned.changes.some((change) => change.field === 'sorgente' && /FIP Analytics/.test(change.newValue)));

  // Il sito pubblico, con un campo e un arbitro diversi e il risultato.
  html = publicHtml({ venue: 'ALTRO CAMPO', ref1: 'VERDI LUCA di TORINO (TO)', score: ['70', '65'] });
  await runFipSync(publicSource.id, { fetchImpl: publicFetch });
  const afterPublic = await getGame(imported.id);
  assert.equal(afterPublic.scoreHome, '70');
  assert.equal(afterPublic.status, 'played');
  assert.equal(afterPublic.venue, owned.venue, 'il calendario resta quello di FIP Analytics');
  assert.equal(afterPublic.officials.referee1.refereeId, rossiId, 'gli arbitri restano quelli di FIP Analytics');

  // Sorgente FIP Analytics disattivata: il sito pubblico torna a decidere tutto.
  await updateSource(gironeA.id, { active: false });
  await runFipSync(publicSource.id, { fetchImpl: publicFetch });
  const released = await getGame(imported.id);
  assert.equal(released.venue, 'ALTRO CAMPO');
  await updateSource(gironeA.id, { active: true });
});

test('senza credenziali o con password cambiata la sincronizzazione lo dice chiaramente', async () => {
  await assert.rejects(
    () => runAnalyticsSync(gironeA.id, { fetchImpl, credentials: { username: '', password: '' } }),
    (err) => err.statusCode === 400 && /Credenziali FIP Analytics non configurate/.test(err.message)
  );

  const rejected = analyticsFetch({ calls: [], items: [], loginResponse: [401, { detail: 'Utente o password errati' }] });
  await assert.rejects(
    () => runSourceSync(gironeA.id, { fetchImpl: rejected, credentials }),
    (err) => err.statusCode === 502 && /password potrebbe essere cambiata/.test(err.message)
  );
  const run = await dbGet('SELECT status FROM sync_runs WHERE competition_source_id = ? ORDER BY id DESC LIMIT 1', [gironeA.id]);
  assert.equal(run.status, 'error', 'il tentativo fallito resta nello storico');
});

test('il giro automatico FIP Analytics parte alle 11:00 e alle 21:00, una volta per orario', async () => {
  state.items = calendar({ first: [rossi(), verdi()] });
  state.calls = [];
  const options = { fetchImpl, credentials, sourceDelayMs: 0 };

  const early = await runScheduledAnalyticsSync({ ...options, now: new Date('2026-10-01T07:00:00Z') }); // 09:00 a Roma
  assert.equal(early.executed, false);
  assert.equal(early.reason, 'before-scheduled-time');

  const morning = await runScheduledAnalyticsSync({ ...options, now: new Date('2026-10-01T09:30:00Z') }); // 11:30
  assert.equal(morning.executed, true);
  assert.equal(morning.runKey, '2026-10-01 11:00');
  assert.equal(morning.summary.totals.sources, 2, 'solo le sorgenti FIP Analytics attive');
  assert.equal(
    state.calls.filter((call) => call.path === '/gare/search').length,
    1,
    'due gironi dello stesso campionato: una sola richiesta'
  );

  const again = await runScheduledAnalyticsSync({ ...options, now: new Date('2026-10-01T12:00:00Z') }); // 14:00
  assert.equal(again.executed, false);
  assert.equal(again.reason, 'already-run');

  const evening = await runScheduledAnalyticsSync({ ...options, now: new Date('2026-10-01T19:05:00Z') }); // 21:05
  assert.equal(evening.executed, true);
  assert.equal(evening.runKey, '2026-10-01 21:00');

  const status = await getScheduledAnalyticsSyncStatus();
  assert.equal(status.lastRunKey, '2026-10-01 21:00');
  assert.deepEqual(status.times, ['11:00', '21:00']);
});
