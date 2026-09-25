import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsSeasonCode,
  createAnalyticsClient,
  fetchAnalyticsGames,
  formatVenue,
  listGironi,
  mapAnalyticsGames,
  normalizeLicense
} from '../src/services/fip/fipAnalyticsAdapter.js';
import { analyticsFetch, designazione, gara } from './helpers/fipAnalyticsFixture.js';

test('la stagione diventa il codice X-Stagione di FIP Analytics', () => {
  assert.equal(analyticsSeasonCode('2026/2027'), '2026_27');
  assert.throws(() => analyticsSeasonCode('2026/2028'), /Stagione non valida/);
  assert.throws(() => analyticsSeasonCode(''), /Stagione non valida/);
});

test('tessera senza zeri iniziali, come in anagrafica', () => {
  assert.equal(normalizeLicense('053553'), '53553');
  assert.equal(normalizeLicense(' 000 '), '0');
  assert.equal(normalizeLicense(null), '');
});

test('il campo di gioco ha la stessa forma del sito pubblico', () => {
  const venue = formatVenue({
    des_campo: 'Pala Campus',
    des_indirizzo: 'Via Giardino, 3',
    des_cap: '12040',
    comune: { des_comune: "Corneliano d'Alba", cod_provincia: 'CN' }
  });
  assert.equal(venue, "Pala Campus, Via Giardino, 3 12040 CORNELIANO D'ALBA ( CN)");
  assert.equal(formatVenue(null), '');
});

test('le gare diventano numero a sei cifre, giornata continua e arbitri attivi', () => {
  const [andata, ritorno] = mapAnalyticsGames([
    gara({
      num: 730,
      giornata: 15,
      casa: 'ZETA  ESSE TI ',
      designazioni: [
        designazione({ ruolo: 'ARB_1', cognome: 'ROSSI', nome: 'MARIO', tessera: '053553', stato: 'accettata' }),
        designazione({ ruolo: 'ARB_2', cognome: 'VERDI', nome: 'LUCA', tessera: '060111', stato: 'rifiutata' }),
        designazione({ ruolo: 'ARB_2', cognome: 'BIANCHI', nome: 'ANNA', tessera: '070000', stato: 'temporanea' }),
        designazione({ ruolo: 'OSS_ARB', cognome: 'NERI', nome: 'PAOLO', tessera: '010000', stato: 'accettata' }),
        designazione({ ruolo: 'CRON', cognome: 'GIALLI', nome: 'SARA', tessera: '020000', stato: 'accettata' })
      ]
    }),
    gara({ num: 1245, giornata: 1, tipo: 'Ritorno', time: null })
  ]);

  assert.equal(andata.matchNumber, '000730');
  assert.equal(andata.matchday, 15);
  assert.equal(andata.leg, 'andata');
  assert.equal(andata.teamHome, 'ZETA ESSE TI', 'spazi normalizzati come sul sito pubblico');
  assert.equal(andata.scheduledAt, '2026-10-03T18:00');
  assert.deepEqual(andata.referees.referee1, { externalName: 'ROSSI MARIO', license: '53553', status: 'confirmed', fipState: 'accettata' });
  assert.deepEqual(
    andata.referees.referee2,
    { externalName: 'BIANCHI ANNA', license: '70000', status: 'provisional', fipState: 'temporanea' },
    'il rifiuto libera il posto, la bozza del designatore resta come provvisoria'
  );
  assert.equal(andata.referees.referee3, null);

  assert.equal(ritorno.leg, 'ritorno');
  assert.equal(ritorno.matchday, 16, 'la prima di ritorno segue l’ultima di andata del girone');
  assert.equal(ritorno.scheduledAt, '2026-10-03T00:00', 'orario mancante come sul sito pubblico');
});

test('revoche e pre-designazioni non occupano il posto', () => {
  const [game] = mapAnalyticsGames([
    gara({
      num: 1,
      designazioni: [
        designazione({ ruolo: 'ARB_1', cognome: 'ROSSI', nome: 'MARIO', tessera: '1', stato: 'revoca' }),
        designazione({ ruolo: 'ARB_2', cognome: 'VERDI', nome: 'LUCA', tessera: '2', stato: 'pre_designata' })
      ]
    })
  ]);
  assert.equal(game.referees.referee1, null);
  assert.equal(game.referees.referee2, null);
});

test('dai dati mappati non esce nessun dato personale oltre nome e tessera', () => {
  const mapped = mapAnalyticsGames([
    gara({ num: 2, designazioni: [designazione({ ruolo: 'ARB_1', cognome: 'ROSSI', nome: 'MARIO', tessera: '1', stato: 'accettata' })] })
  ]);
  const text = JSON.stringify(mapped);
  for (const personal of ['XXXYYY00A00Z000X', '3330000000', '@example.invalid', '1990-01-01']) {
    assert.equal(text.includes(personal), false, `${personal} non deve uscire dall'adapter`);
  }
});

test('un girone per ogni coppia fase + girone', () => {
  const gironi = listGironi(
    mapAnalyticsGames([gara({ num: 1 }), gara({ num: 2, girone: 'Girone B' }), gara({ num: 3 })])
  );
  assert.deepEqual(gironi, [
    { phase: 'Qualificazione', girone: 'Girone A', games: 2 },
    { phase: 'Qualificazione', girone: 'Girone B', games: 1 }
  ]);
});

test('il client fa login, manda la stagione e legge tutte le pagine', async () => {
  const state = { calls: [], items: Array.from({ length: 3 }, (_, i) => gara({ num: 10 + i })) };
  const client = createAnalyticsClient({ username: 'utente', password: 'segreta', fetchImpl: analyticsFetch(state) });
  const games = await fetchAnalyticsGames({ client, season: '2026/2027', codCampionato: 'D' });

  assert.equal(games.length, 3);
  assert.equal(state.calls[0].path, '/auth/login');
  assert.match(state.calls[0].body, /username=utente/);
  const search = state.calls.find((call) => call.path === '/gare/search');
  assert.equal(search.method, 'POST');
  assert.equal(search.headers['X-Stagione'], '2026_27');
  assert.deepEqual(JSON.parse(search.body).search, { cod_campionato: ['D'] });
});

test('sono possibili solo le chiamate di lettura previste', async () => {
  const state = { calls: [], items: [] };
  const client = createAnalyticsClient({ username: 'utente', password: 'segreta', fetchImpl: analyticsFetch(state) });
  await assert.rejects(
    () => client.call('POST', '/designa-manuale/gare/1/designazioni'),
    /non consentita/
  );
  assert.equal(state.calls.length, 0, 'la richiesta non parte nemmeno');
});

test('credenziali assenti, rifiutate o secondo fattore danno un errore chiaro', async () => {
  await assert.rejects(
    () => createAnalyticsClient({ fetchImpl: analyticsFetch({ calls: [], items: [] }) }).login(),
    (err) => err.statusCode === 400 && /FIP_ANALYTICS_USERNAME/.test(err.message)
  );

  const rejected = { calls: [], items: [], loginResponse: [401, { detail: 'Utente o password errati' }] };
  await assert.rejects(
    () => createAnalyticsClient({ username: 'u', password: 'p', fetchImpl: analyticsFetch(rejected) }).login(),
    (err) => err.statusCode === 502 && /password potrebbe essere cambiata/.test(err.message)
  );

  const mfa = { calls: [], items: [], loginResponse: [200, { mfa_required: true, mfa_token: 'x', available_methods: ['email'] }] };
  await assert.rejects(
    () => createAnalyticsClient({ username: 'u', password: 'p', fetchImpl: analyticsFetch(mfa) }).login(),
    /secondo fattore/
  );
});
