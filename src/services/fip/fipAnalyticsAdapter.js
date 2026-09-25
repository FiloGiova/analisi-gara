import { HttpError } from '../../utils/httpError.js';

// Tutta la logica specifica di FIP Analytics (analytics.fip.it) vive qui: se
// l'API cambia, va aggiornato solo questo file (più le fixture dei test).
//
// L'account usato è quello di un designatore e può anche MODIFICARE le
// designazioni: per questo le uniche chiamate possibili sono quelle elencate in
// ALLOWED_CALLS, tutte di sola lettura. Dalle risposte si tengono solo nome,
// tessera, ruolo e stato degli arbitri: codice fiscale, telefono, email e data
// di nascita che la piattaforma restituisce non escono mai da questo modulo.

const API_BASE = 'https://analytics.fip.it/api';
const API_HOST = 'analytics.fip.it';
const FETCH_TIMEOUT_MS = 30000;
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

const ALLOWED_CALLS = new Set(['POST /auth/login', 'POST /gare/search', 'GET /gare/filtri']);

const REFEREE_ROLE_BY_CODE = { ARB_1: 'referee1', ARB_2: 'referee2', ARB_3: 'referee3' };

// Stati FIP della designazione. "temporanea" è la bozza del designatore: si
// importa ma resta provvisoria. Rifiuti, revoche e pre-designazioni non
// occupano il posto.
const ACTIVE_STATES = {
  temporanea: 'provisional',
  trasmessa: 'confirmed',
  accettata: 'confirmed'
};

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// "2026/2027" → "2026_27", il formato dell'header X-Stagione.
export function analyticsSeasonCode(sportSeason) {
  const match = cleanText(sportSeason).match(/^(\d{4})\/(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new HttpError(400, `Stagione non valida per FIP Analytics: ${sportSeason || '(vuota)'}.`);
  }
  return `${match[1]}_${match[2].slice(2)}`;
}

// La FIP scrive la tessera con gli zeri iniziali (053553), l'anagrafica no.
export function normalizeLicense(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits ? digits.replace(/^0+(?=\d)/, '') : '';
}

// Il sito pubblico numera le gare a sei cifre ("000730"): stesso formato, così
// le due sorgenti si ritrovano sulla stessa riga.
export function formatMatchNumber(numGara) {
  const digits = String(numGara ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(6, '0') : '';
}

// Stessa forma del campo "Campo di gioco" del sito pubblico
// ("Pala Campus, Via Giardino, 3 12040 CORNELIANO D'ALBA ( CN)"): con un testo
// diverso ogni gara già importata risulterebbe modificata al primo passaggio.
export function formatVenue(campo) {
  if (!campo) return '';
  const comune = campo.comune || {};
  const place = [cleanText(campo.des_indirizzo), cleanText(campo.des_cap), cleanText(comune.des_comune).toUpperCase()]
    .filter(Boolean)
    .join(' ');
  const full = [cleanText(campo.des_campo), place].filter(Boolean).join(', ');
  const province = cleanText(comune.cod_provincia);
  return full && province ? `${full} ( ${province})` : full;
}

function legOf(gara) {
  const type = cleanText(gara.des_tipo_giornata).toLowerCase();
  if (type.startsWith('andata')) return 'andata';
  if (type.startsWith('ritorno')) return 'ritorno';
  return null;
}

function groupKey(gara) {
  return `${cleanText(gara.cod_campionato)}|${cleanText(gara.des_fase)}|${cleanText(gara.des_girone)}`;
}

function activeReferees(designazioni = []) {
  const byRole = {};
  for (const designazione of designazioni) {
    const role = REFEREE_ROLE_BY_CODE[designazione.cod_ruolo];
    const state = designazione.stato?.stato_designazione;
    const status = ACTIVE_STATES[state];
    if (!role || !status) continue;
    const person = designazione.tessera?.tesserato || {};
    const externalName = cleanText(`${person.cognome || ''} ${person.nome || ''}`);
    if (!externalName) continue;
    const modifiedAt = String(designazione.dat_ultima_modifica || '');
    // Più designazioni attive sullo stesso ruolo non dovrebbero esistere: se
    // capita, vale l'ultima modificata.
    if (byRole[role] && byRole[role].modifiedAt >= modifiedAt) continue;
    byRole[role] = {
      externalName,
      license: normalizeLicense(designazione.cod_tessera || designazione.tessera?.cod_tessera),
      status,
      fipState: state,
      modifiedAt
    };
  }
  return Object.fromEntries(
    Object.values(REFEREE_ROLE_BY_CODE).map((role) => {
      const entry = byRole[role];
      return [role, entry ? { externalName: entry.externalName, license: entry.license, status: entry.status, fipState: entry.fipState } : null];
    })
  );
}

// Funzione pura: dalle gare restituite da /gare/search ai dati che servono al
// sync. Andata e ritorno ripartono entrambe da 1 anche qui: la numerazione
// diventa continua (1..N andata, N+1..2N ritorno) come per il sito pubblico.
export function mapAnalyticsGames(items = []) {
  const lastAndata = new Map();
  for (const gara of items) {
    if (legOf(gara) !== 'andata') continue;
    const key = groupKey(gara);
    lastAndata.set(key, Math.max(lastAndata.get(key) || 0, Number(gara.num_giornata) || 0));
  }

  return items
    .map((gara) => {
      const leg = legOf(gara);
      const giornata = Number(gara.num_giornata) || null;
      const offset = leg === 'ritorno' ? lastAndata.get(groupKey(gara)) || 0 : 0;
      const date = cleanText(gara.dat_gara).slice(0, 10);
      const time = cleanText(gara.ora_gara).slice(0, 5) || '00:00';
      return {
        matchNumber: formatMatchNumber(gara.num_gara),
        codCampionato: cleanText(gara.cod_campionato),
        phase: cleanText(gara.des_fase),
        girone: cleanText(gara.des_girone),
        matchday: giornata ? giornata + offset : null,
        leg,
        scheduledAt: date ? `${date}T${time}` : '',
        teamHome: cleanText(gara.squadra_a?.des_squadra || gara.des_squadra_a_placeholder),
        teamAway: cleanText(gara.squadra_b?.des_squadra || gara.des_squadra_b_placeholder),
        venue: formatVenue(gara.campo),
        deleted: Boolean(gara.flg_deleted),
        referees: activeReferees(gara.designazioni)
      };
    })
    .filter((game) => game.matchNumber);
}

// Gironi (e fasi) presenti nel campionato: una sorgente per ognuno, come per
// il sito pubblico, così l'elenco gare resta raggruppato per girone.
export function listGironi(games = []) {
  const seen = new Map();
  for (const game of games) {
    const key = `${game.phase}|${game.girone}`;
    if (!seen.has(key)) seen.set(key, { phase: game.phase, girone: game.girone, games: 0 });
    seen.get(key).games += 1;
  }
  return [...seen.values()].sort((a, b) => a.phase.localeCompare(b.phase) || a.girone.localeCompare(b.girone));
}

export function createAnalyticsClient({ username = '', password = '', fetchImpl = fetch } = {}) {
  let accessToken = null;

  function assertAllowed(method, path) {
    if (!ALLOWED_CALLS.has(`${method} ${path}`)) {
      throw new HttpError(500, `Chiamata FIP Analytics non consentita: ${method} ${path}.`);
    }
  }

  async function send(method, path, { form, json, season, authenticated = true } = {}) {
    assertAllowed(method, path);
    const headers = { Accept: 'application/json', 'User-Agent': 'FischioLab/1.0 (sola lettura)' };
    if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (season) headers['X-Stagione'] = analyticsSeasonCode(season);
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(`${API_BASE}${path}`, { method, headers, body, signal: controller.signal });
    } catch (err) {
      throw new HttpError(502, `FIP Analytics non raggiungibile: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (response.url && new URL(response.url).hostname !== API_HOST) {
      throw new HttpError(502, 'FIP Analytics ha rediretto verso un host non consentito.');
    }

    let data = null;
    try {
      data = JSON.parse(await response.text());
    } catch {
      data = null;
    }
    return { status: response.status, ok: response.ok, data };
  }

  async function login() {
    if (!username || !password) {
      throw new HttpError(
        400,
        'Credenziali FIP Analytics non configurate: impostare FIP_ANALYTICS_USERNAME e FIP_ANALYTICS_PASSWORD nelle variabili d’ambiente.'
      );
    }
    const res = await send('POST', '/auth/login', {
      form: { grant_type: 'password', username, password },
      authenticated: false
    });
    if (res.status === 400 || res.status === 401) {
      throw new HttpError(
        502,
        'FIP Analytics ha rifiutato le credenziali: la password potrebbe essere cambiata. Aggiornare FIP_ANALYTICS_PASSWORD nelle variabili d’ambiente.'
      );
    }
    if (!res.ok) throw new HttpError(502, `Accesso a FIP Analytics non riuscito (HTTP ${res.status}).`);
    if (res.data?.mfa_required) {
      throw new HttpError(
        502,
        'FIP Analytics ora chiede il secondo fattore (codice via email): la sincronizzazione automatica non può completarlo. Disattivare le sorgenti FIP Analytics e usare il sito FIP finché non è risolto.'
      );
    }
    if (!res.data?.access_token) throw new HttpError(502, 'Risposta di accesso di FIP Analytics non riconosciuta.');
    accessToken = res.data.access_token;
  }

  async function call(method, path, options = {}) {
    assertAllowed(method, path);
    if (!accessToken) await login();
    let res = await send(method, path, options);
    const permissionDenied = res.data?.code === 'InsufficientPermissionsError';
    if ((res.status === 401 || res.status === 403) && !permissionDenied) {
      // Token scaduto durante la sessione: un solo nuovo accesso.
      await login();
      res = await send(method, path, options);
    }
    if (res.data?.code === 'InsufficientPermissionsError') {
      throw new HttpError(502, 'L’account FIP Analytics configurato non ha i permessi per leggere le gare.');
    }
    if (!res.ok) {
      const detail = res.data?.message || res.data?.detail || 'errore sconosciuto';
      throw new HttpError(502, `FIP Analytics ha risposto ${res.status}: ${typeof detail === 'string' ? detail : 'richiesta non valida'}.`);
    }
    return res.data;
  }

  return { login, call };
}

// Tutte le gare di un campionato nella stagione, con le designazioni. Una
// richiesta basta per una stagione intera (poche centinaia di gare).
export async function fetchAnalyticsGames({ client, season, codCampionato }) {
  const items = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await client.call('POST', '/gare/search', {
      season,
      json: {
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        search: { cod_campionato: [codCampionato] },
        sort_by: 'dat_gara',
        sort_order: 'asc'
      }
    });
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    if (batch.length < PAGE_SIZE || items.length >= Number(data?.total || 0)) break;
  }
  return mapAnalyticsGames(items);
}

// Campionati visibili all'account nella stagione, per il modulo di creazione.
export async function fetchAnalyticsCampionati({ client, season }) {
  const data = await client.call('GET', '/gare/filtri', { season });
  return (Array.isArray(data?.campionati) ? data.campionati : [])
    .map((item) => ({ code: cleanText(item.cod), label: cleanText(item.des) }))
    .filter((item) => item.code);
}
