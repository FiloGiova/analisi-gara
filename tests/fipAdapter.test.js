import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFipUrl,
  parseResultsPage,
  parseItalianDateTime,
  parseGironiOptions,
  buildGiornataUrl,
  assignContinuousMatchdays
} from '../src/services/fip/fipAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'fip-risultati-dr1-giornata1.html'), 'utf8');
const noGironeHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'fip-risultati-dr1-no-girone.html'), 'utf8');
const playoffHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'fip-risultati-c1-playoff.html'), 'utf8');

test('parseResultsPage estrae le gare dalla pagina FIP reale', () => {
  const { games, giornate } = parseResultsPage(fixtureHtml);

  assert.equal(games.length, 5);
  assert.equal(giornate.length, 11);
  assert.deepEqual(giornate.slice(0, 3), [1, 2, 3]);

  const game = games.find((g) => g.matchNumber === '000364');
  assert.ok(game, 'la gara 000364 deve esistere');
  assert.equal(game.teamHome, 'MAGIC OLEGGIO JUNIOR BASKET');
  assert.equal(game.teamAway, 'BORGOMANERO SPORTING CLUB');
  assert.equal(game.scoreHome, '105');
  assert.equal(game.scoreAway, '88');
  assert.equal(game.scheduledAt, '2025-12-17T21:15');
  assert.equal(game.referee1, 'VENTURI JACOPO', 'solo Cognome Nome, senza provenienza territoriale');
  assert.equal(game.referee3, '', 'la designazione in attesa deve risultare vuota');
  assert.equal(game.status, 'played');
});

test('parseResultsPage preserva gli zeri iniziali del numero gara', () => {
  const { games } = parseResultsPage(fixtureHtml);
  for (const game of games) {
    assert.match(game.matchNumber, /^\d{6}$/);
    assert.ok(game.matchNumber.startsWith('000'), `numero gara ${game.matchNumber} senza zeri iniziali`);
  }
});

test('parseResultsPage distingue andata/ritorno via codice_ar (giornate 1-11 riusate)', () => {
  const { giornateRefs } = parseResultsPage(fixtureHtml);
  assert.equal(giornateRefs.length, 22, '11 andata + 11 ritorno, non 11 sovrapposte');
  const andata = giornateRefs.filter((r) => r.leg === 'andata');
  const ritorno = giornateRefs.filter((r) => r.leg === 'ritorno');
  assert.equal(andata.length, 11);
  assert.equal(ritorno.length, 11);
  assert.equal(andata.every((r) => r.codiceAr === '1'), true, 'andata = codice_ar 1');
  assert.equal(ritorno.every((r) => r.codiceAr === '0'), true, 'ritorno = codice_ar 0');
});

test('assignContinuousMatchdays numera andata 1..N e ritorno N+1..2N', () => {
  const refs = [];
  for (let g = 1; g <= 11; g += 1) refs.push({ codiceAr: '1', giornata: g, leg: 'andata' });
  for (let g = 1; g <= 11; g += 1) refs.push({ codiceAr: '0', giornata: g, leg: 'ritorno' });
  const numbered = assignContinuousMatchdays(refs);
  const andata = numbered.filter((r) => r.leg === 'andata');
  const ritorno = numbered.filter((r) => r.leg === 'ritorno');
  assert.deepEqual(andata.map((r) => r.matchday), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(ritorno.map((r) => r.matchday), [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);

  // Girone unico (nessuna etichetta andata/ritorno): la numerazione resta 1..N.
  const single = assignContinuousMatchdays([
    { codiceAr: null, giornata: 1, leg: null },
    { codiceAr: null, giornata: 2, leg: null }
  ]);
  assert.deepEqual(single.map((r) => r.matchday), [1, 2]);
});

test('parseFipUrl accetta solo link FIP validi', () => {
  const params = parseFipUrl(
    'https://fip.it/risultati/?codice_ar=0&codice_campionato=D&codice_fase=1&codice_girone=74971&comitato_codice=RPI&giornata=1&group=campionati-regionali&regione_codice=PI&sesso=M'
  );
  assert.equal(params.codice_girone, '74971');
  assert.equal(params.comitato_codice, 'RPI');
  assert.equal(params.giornata, undefined, 'giornata non fa parte dei parametri di competizione');

  assert.throws(() => parseFipUrl('http://fip.it/risultati/?codice_girone=1'), /HTTPS/);
  assert.throws(() => parseFipUrl('https://evil.example.com/?codice_girone=1'), /Host non consentito/);
  assert.throws(() => parseFipUrl('https://fip.it/risultati/?group=campionati-regionali'), /campionato/);
  assert.throws(() => parseFipUrl('non-un-url'), /non valida/);

  // Il link senza girone (com'è quando non si usa il menu a tendina) è valido:
  // il girone verrà scoperto dalla pagina.
  const senzaGirone = parseFipUrl('https://fip.it/risultati/?group=campionati-regionali&regione_codice=PI&comitato_codice=RPI&sesso=M&codice_campionato=D&codice_fase=1');
  assert.equal(senzaGirone.codice_campionato, 'D');
  assert.equal(senzaGirone.codice_girone, undefined);
});

test('parseGironiOptions estrae i gironi dal menu della pagina', () => {
  const gironi = parseGironiOptions(noGironeHtml);
  assert.equal(gironi.length, 3);
  assert.deepEqual(gironi[0], { codice: '74971', label: 'Girone A' });
  assert.deepEqual(gironi.map((g) => g.label), ['Girone A', 'Girone B', 'Girone C']);
});

test('le fasi finali (playoff Serie C) usano la stessa struttura: accoppiamento come girone, gare della serie come giornate', () => {
  const gironi = parseGironiOptions(playoffHtml);
  assert.deepEqual(gironi, [{ codice: '84802', label: 'Finale 1 posto' }]);

  const { games, giornate } = parseResultsPage(playoffHtml);
  assert.deepEqual(giornate, [1, 2], 'gara 1 e gara 2 della serie');
  assert.equal(games.length, 1);
  assert.equal(games[0].matchNumber, '013718');
  assert.equal(games[0].teamHome, 'CUS TORINO ASD');
  assert.equal(games[0].referee1, "LAZZERETTI NICCOLO'", 'nome pulito anche qui');
  assert.ok(games[0].scheduledAt.startsWith('2026-06-13T'), 'data giugno 2026 interpretata');
});

test('buildGiornataUrl costruisce URL su host FIP con la giornata richiesta', () => {
  const url = new URL(buildGiornataUrl({ codice_girone: '74971', regione_codice: 'PI' }, 7));
  assert.equal(url.hostname, 'www.fip.it');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('giornata'), '7');
  assert.equal(url.searchParams.get('codice_girone'), '74971');
});

test('parseItalianDateTime interpreta le date italiane', () => {
  assert.equal(parseItalianDateTime('17 Dicembre 2025', '21:15'), '2025-12-17T21:15');
  assert.equal(parseItalianDateTime('5 Gennaio 2026', '9:00'), '2026-01-05T09:00');
  assert.equal(parseItalianDateTime('17 Dicembre 2025', ''), '2025-12-17T00:00');
  assert.equal(parseItalianDateTime('data ignota', '21:15'), null);
});
