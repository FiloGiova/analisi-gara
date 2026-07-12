import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analisigara-test-'));
process.env.STORAGE_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');

const { initializeDatabase, getDb, closeDatabase } = await import('../src/database/connection.js');
const { createSource, runFipSync } = await import('../src/services/syncService.js');
const { getGame, listGames, setOfficial, getOfficialRow } = await import('../src/services/gameService.js');

initializeDatabase();

// Fixture sintetica con la stessa struttura DOM della pagina risultati FIP.
function fipHtml(games) {
  const links = '<a href="https://fip.it/risultati/?codice_girone=999&giornata=1">1</a>';
  const blocks = games
    .map(
      (g) => `
    <div class="results-matches__match">
      <div class="teams">
        <div class="team"><div class="team__name">${g.home}</div><div class="team__points">${g.scoreHome ?? ''}</div></div>
        <div class="team"><div class="team__name">${g.away}</div><div class="team__points">${g.scoreAway ?? ''}</div></div>
      </div>
      <div class="results-matches__match__info">
        <div class="datetime"><div class="date">${g.date}</div><div class="time">${g.time}</div></div>
        <div class="ref">${g.num}</div>
      </div>
      <div class="results-matches__match__moreinfo">
        <div class="info"><div class="label">Squadra di casa</div><div class="value">${g.home}</div></div>
        <div class="info"><div class="label">Squadra ospite</div><div class="value">${g.away}</div></div>
        <div class="info"><div class="label">Campo di gioco</div><div class="value">${g.venue || ''}</div></div>
        <div class="info"><div class="label">1° Arbitro</div><div class="value">${g.ref1 || 'Designazione in attesa di conferma.'}</div></div>
        <div class="info"><div class="label">2° Arbitro</div><div class="value">${g.ref2 || 'Designazione in attesa di conferma.'}</div></div>
      </div>
    </div>`
    )
    .join('');
  return `<html><body>${links}${blocks}</body></html>`;
}

let currentHtml = '';
const fetchImpl = (url) =>
  Promise.resolve({
    ok: true,
    status: 200,
    url,
    text: () => Promise.resolve(currentHtml)
  });

const venturiId = getDb()
  .prepare('INSERT INTO referees (first_name, last_name) VALUES (?, ?)')
  .run('Jacopo', 'Venturi').lastInsertRowid;
const observerId = getDb()
  .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES ('oss', 'x', 'Osservatore Test', 'observer')")
  .run().lastInsertRowid;

const { sources: [source] } = await createSource({
  sportSeason: '2025/2026',
  name: 'Test girone',
  url: 'https://fip.it/risultati/?codice_girone=999&regione_codice=PI'
});

const noGironeHtml = fs.readFileSync(new URL('./fixtures/fip-risultati-dr1-no-girone.html', import.meta.url), 'utf8');

const CALENDAR_ONLY = [
  { num: '000311', home: 'CASA A', away: 'OSPITE A', date: '17 Dicembre 2025', time: '21:15' },
  { num: '000308', home: 'CASA B', away: 'OSPITE B', date: '18 Dicembre 2025', time: '18:00' }
];

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un link senza girone crea automaticamente una sorgente per ogni girone della fase', async () => {
  const gironiFetch = (url) => Promise.resolve({ ok: true, status: 200, url, text: () => Promise.resolve(noGironeHtml) });
  const urlSenzaGirone = 'https://fip.it/risultati/?group=campionati-regionali&regione_codice=PI&comitato_codice=RPI&sesso=M&codice_campionato=D&codice_fase=1';

  const { sources, skipped } = await createSource(
    { sportSeason: '2025/2026', name: 'DR1', url: urlSenzaGirone },
    { fetchImpl: gironiFetch }
  );
  assert.equal(sources.length, 3, 'un girone = una sorgente, senza chiedere nulla');
  assert.equal(skipped.length, 0);
  assert.deepEqual(sources.map((s) => s.name), ['DR1 — Girone A', 'DR1 — Girone B', 'DR1 — Girone C']);
  assert.deepEqual(sources.map((s) => s.params.codice_girone), ['74971', '74972', '74973']);
  assert.ok(sources[1].url.includes('codice_girone=74972'), 'ogni sorgente salva il proprio girone nell\'URL');

  // Ripetere l'operazione non crea duplicati.
  await assert.rejects(
    () => createSource({ sportSeason: '2025/2026', url: urlSenzaGirone }, { fetchImpl: gironiFetch }),
    (err) => err.statusCode === 409 && /già configurati/.test(err.message)
  );
});

test('la prima sincronizzazione crea il calendario con arbitri vuoti', async () => {
  currentHtml = fipHtml(CALENDAR_ONLY);
  const result = await runFipSync(source.id, { fetchImpl });

  assert.equal(result.created, 2);
  assert.equal(result.updated, 0);
  const games = listGames({ season: '2025/2026' });
  assert.equal(games.length, 2);
  // Ordinamento per data: la gara del 17/12 precede quella del 18/12.
  assert.equal(games[0].matchNumber, '000311');
  assert.equal(games.every((g) => !g.officials.referee1 && !g.officials.observer), true);
  assert.equal(games.every((g) => g.derivedState === 'calendario'), true);
});

test('la sincronizzazione è idempotente: stesso input, nessuna modifica', async () => {
  currentHtml = fipHtml(CALENDAR_ONLY);
  const changesBefore = getDb().prepare('SELECT COUNT(*) AS n FROM game_changes').get().n;
  const result = await runFipSync(source.id, { fetchImpl });

  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.officialsUpdated, 0);
  const changesAfter = getDb().prepare('SELECT COUNT(*) AS n FROM game_changes').get().n;
  assert.equal(changesAfter, changesBefore, 'nessuna riga di audit per un sync senza differenze');
});

test('le designazioni pubblicate aggiornano le gare esistenti senza duplicarle', async () => {
  currentHtml = fipHtml([
    { ...CALENDAR_ONLY[0], ref1: 'VENTURI JACOPO di TORINO (TO)', ref2: 'SCONOSCIUTO PINCO di NOVARA (NO)' },
    CALENDAR_ONLY[1]
  ]);
  const result = await runFipSync(source.id, { fetchImpl });

  assert.equal(result.created, 0, 'nessun duplicato');
  assert.equal(result.officialsUpdated, 2);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].externalName, 'SCONOSCIUTO PINCO', 'nome pulito, senza provenienza');

  const games = listGames({ season: '2025/2026' });
  const game = games.find((g) => g.matchNumber === '000311');
  assert.equal(game.officials.referee1.refereeId, venturiId, 'nome FIP associato all\'anagrafica');
  assert.equal(game.officials.referee2.refereeId, null, 'nome non riconosciuto resta da associare');
  assert.equal(game.needsAlias, true);
});

test("l'osservatore assegnato manualmente sopravvive alle sincronizzazioni", async () => {
  const games = listGames({ season: '2025/2026' });
  const game = games.find((g) => g.matchNumber === '000311');
  setOfficial(game.id, { role: 'observer', userId: observerId, source: 'manual' }, {});

  currentHtml = fipHtml([
    { ...CALENDAR_ONLY[0], ref1: 'VENTURI JACOPO di TORINO (TO)', ref2: 'SCONOSCIUTO PINCO di NOVARA (NO)' },
    CALENDAR_ONLY[1]
  ]);
  await runFipSync(source.id, { fetchImpl });

  const after = getGame(game.id);
  assert.equal(after.officials.observer.userId, observerId, 'osservatore mai toccato dal sync FIP');
});

test('un valore bloccato manualmente genera conflitto e non viene sovrascritto', async () => {
  const games = listGames({ season: '2025/2026' });
  const game = games.find((g) => g.matchNumber === '000308');
  setOfficial(game.id, { role: 'referee1', refereeId: venturiId, externalName: 'Venturi Jacopo', source: 'manual', manualLock: true }, {});

  currentHtml = fipHtml([
    CALENDAR_ONLY[0].num === '000311' ? { ...CALENDAR_ONLY[0], ref1: 'VENTURI JACOPO di TORINO (TO)', ref2: 'SCONOSCIUTO PINCO di NOVARA (NO)' } : CALENDAR_ONLY[0],
    { ...CALENDAR_ONLY[1], ref1: 'ALTRO ARBITRO di ASTI (AT)' }
  ]);
  const result = await runFipSync(source.id, { fetchImpl });

  assert.equal(result.status, 'partial');
  assert.ok(result.conflicts.some((c) => c.matchNumber === '000308' && c.field === 'ufficiale:referee1'));

  const official = getOfficialRow(game.id, 'referee1');
  assert.equal(official.referee_id, venturiId, 'il valore bloccato resta invariato');
  assert.equal(official.manual_lock, 1);
});

test('cambi di data e campo vengono applicati e tracciati in game_changes', async () => {
  currentHtml = fipHtml([
    { ...CALENDAR_ONLY[0], time: '20:30', venue: 'NUOVO PALASPORT', ref1: 'VENTURI JACOPO di TORINO (TO)', ref2: 'SCONOSCIUTO PINCO di NOVARA (NO)' },
    { ...CALENDAR_ONLY[1], ref1: 'ALTRO ARBITRO di ASTI (AT)' }
  ]);
  const result = await runFipSync(source.id, { fetchImpl });

  assert.equal(result.updated, 1);
  const games = listGames({ season: '2025/2026' });
  const game = games.find((g) => g.matchNumber === '000311');
  assert.equal(game.scheduledAt, '2025-12-17T20:30');
  assert.equal(game.venue, 'NUOVO PALASPORT');

  const detail = getGame(game.id);
  const audited = detail.changes.filter((c) => c.source === 'fip_public' && (c.field === 'scheduledAt' || c.field === 'venue'));
  assert.ok(audited.length >= 2, 'le modifiche da sync sono ricostruibili dallo storico');
});
