import * as cheerio from 'cheerio';
import { HttpError } from '../../utils/httpError.js';
import { cleanExternalName } from '../nameMatching.js';

// Tutta la logica specifica del sito pubblico FIP vive qui: se il markup o gli
// URL cambiano, va aggiornato solo questo file (più le fixture dei test).

const ALLOWED_HOSTS = new Set(['fip.it', 'www.fip.it']);
const FIP_BASE_URL = 'https://www.fip.it/risultati/';
const FETCH_TIMEOUT_MS = 15000;
const REQUEST_DELAY_MS = 1000;

// Parametri che identificano una competizione sul sito FIP. "giornata" è
// volutamente escluso: viene aggiunto a ogni richiesta.
const COMPETITION_PARAMS = [
  'group',
  'regione_codice',
  'comitato_codice',
  'sesso',
  'codice_campionato',
  'codice_fase',
  'codice_girone',
  'codice_ar'
];

const ITALIAN_MONTHS = {
  gennaio: '01',
  febbraio: '02',
  marzo: '03',
  aprile: '04',
  maggio: '05',
  giugno: '06',
  luglio: '07',
  agosto: '08',
  settembre: '09',
  ottobre: '10',
  novembre: '11',
  dicembre: '12'
};

// Testi che il sito mostra al posto di un nominativo quando la designazione
// non è (ancora) pubblica.
const MISSING_OFFICIAL_PATTERNS = [
  /designazione in attesa/i,
  /gara non ancora designata/i,
  /non disponibile/i
];

export function parseFipUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new HttpError(400, 'URL FIP non valida.');
  }
  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'Sono consentiti solo URL FIP in HTTPS.');
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new HttpError(400, 'Host non consentito: incolla un link del sito pubblico fip.it.');
  }

  const params = {};
  for (const key of COMPETITION_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') params[key] = value;
  }

  // Il girone può mancare (il sito non lo mette nell'URL finché non si usa il
  // menu a tendina): in quel caso verrà scoperto dalla pagina stessa. Serve
  // però almeno il campionato, altrimenti il link è la pagina generica.
  if (!params.codice_girone && !params.codice_campionato) {
    throw new HttpError(400, 'Link FIP incompleto: aprire la pagina Risultati e selezionare almeno il campionato.');
  }

  return params;
}

// Estrae i gironi disponibili dal selettore della pagina risultati.
export function parseGironiOptions(html) {
  const $ = cheerio.load(html);
  const gironi = [];
  $('select[name="gironi"] option').each((_, el) => {
    const codice = cleanText($(el).attr('value'));
    if (!/^\d+$/.test(codice)) return;
    gironi.push({ codice, label: cleanText($(el).text()) || `Girone ${codice}` });
  });
  return gironi;
}

// Scopre i gironi di una competizione quando il link incollato non contiene
// codice_girone: la pagina FIP li espone comunque nel menu a tendina.
export async function discoverGironi(params, { fetchImpl = fetch } = {}) {
  const html = await fetchGiornataHtml(params, 1, { fetchImpl });
  return parseGironiOptions(html);
}

export function buildGiornataUrl(params, giornata, { codiceAr } = {}) {
  const url = new URL(FIP_BASE_URL);
  for (const key of COMPETITION_PARAMS) {
    if (params[key] !== undefined && params[key] !== '') url.searchParams.set(key, params[key]);
  }
  // codice_ar per-giornata (andata/ritorno) ha la precedenza su quello della sorgente.
  if (codiceAr !== undefined && codiceAr !== null && codiceAr !== '') {
    url.searchParams.set('codice_ar', String(codiceAr));
  }
  url.searchParams.set('giornata', String(giornata));
  return url.toString();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function officialValue(value) {
  const clean = cleanText(value);
  if (!clean) return '';
  if (MISSING_OFFICIAL_PATTERNS.some((pattern) => pattern.test(clean))) return '';
  // Il sito FIP aggiunge la provenienza ("di TORINO (TO)"): si conserva solo
  // Cognome Nome, coerente con l'anagrafica arbitri.
  return cleanExternalName(clean);
}

export function parseItalianDateTime(dateText, timeText) {
  const dateMatch = cleanText(dateText).match(/^(\d{1,2})\s+([A-Za-zà-ù]+)\s+(\d{4})$/);
  if (!dateMatch) return null;
  const month = ITALIAN_MONTHS[dateMatch[2].toLowerCase()];
  if (!month) return null;
  const day = dateMatch[1].padStart(2, '0');
  const timeMatch = cleanText(timeText).match(/^(\d{1,2}):(\d{2})$/);
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '00:00';
  return `${dateMatch[3]}-${month}-${day}T${time}`;
}

function deriveStatus(statusText, scoreHome, scoreAway) {
  const clean = cleanText(statusText).toLowerCase();
  if (clean.includes('rinviat')) return 'postponed';
  if (clean.includes('annullat')) return 'cancelled';
  if (clean.includes('omologata')) return 'played';
  if (scoreHome !== '' && scoreAway !== '') return 'played';
  return 'scheduled';
}

// Funzione pura: riceve l'HTML di una pagina risultati FIP e restituisce le
// gare della giornata visualizzata più l'elenco delle giornate disponibili.
export function parseResultsPage(html) {
  const $ = cheerio.load(html);

  const giornate = new Set();
  $('a[href*="giornata="]').each((_, el) => {
    const match = String($(el).attr('href') || '').match(/[?&]giornata=(\d+)/);
    if (match) giornate.add(Number(match[1]));
  });

  // Andata/ritorno: la FIP le distingue col parametro codice_ar, NON col numero
  // di giornata (che riparte da 1 in entrambe). Il menu <option> etichetta ogni
  // codice_ar come ANDATA o RITORNO: da lì ricaviamo la mappa codice_ar -> leg.
  const legByCodiceAr = {};
  $('option').each((_, el) => {
    const value = String($(el).attr('value') || '');
    const ar = value.match(/[?&]codice_ar=(\d+)/);
    if (!ar || !/giornata=\d+/.test(value)) return;
    const label = cleanText($(el).text()).toLowerCase();
    const leg = /andata/.test(label) ? 'andata' : /ritorno/.test(label) ? 'ritorno' : null;
    if (leg && !legByCodiceAr[ar[1]]) legByCodiceAr[ar[1]] = leg;
  });

  // Coppie (codice_ar, giornata) presenti nella navigazione: sono le pagine da
  // scaricare. Senza questa distinzione andata e ritorno si sovrappongono.
  const giornateRefs = [];
  const seenRef = new Set();
  $('a[href*="giornata="]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    const g = href.match(/[?&]giornata=(\d+)/);
    if (!g) return;
    const ar = href.match(/[?&]codice_ar=(\d+)/);
    const codiceAr = ar ? ar[1] : null;
    const key = `${codiceAr}|${g[1]}`;
    if (seenRef.has(key)) return;
    seenRef.add(key);
    giornateRefs.push({
      codiceAr,
      giornata: Number(g[1]),
      leg: codiceAr !== null ? legByCodiceAr[codiceAr] || null : null
    });
  });

  const games = [];
  $('.results-matches__match').each((_, el) => {
    const block = $(el);

    const teams = block.find('.teams .team');
    const teamHome = cleanText(teams.eq(0).find('.team__name').text());
    const teamAway = cleanText(teams.eq(1).find('.team__name').text());
    const scoreHome = cleanText(teams.eq(0).find('.team__points').text());
    const scoreAway = cleanText(teams.eq(1).find('.team__points').text());

    const matchNumber = cleanText(block.find('.results-matches__match__info .ref').text());
    const dateText = cleanText(block.find('.datetime .date').text());
    const timeText = cleanText(block.find('.datetime .time').text());
    const statusText = cleanText(block.find('.match-status').text());

    const info = {};
    block.find('.results-matches__match__moreinfo .info').each((__, infoEl) => {
      const label = cleanText($(infoEl).find('.label').text());
      if (label) info[label] = cleanText($(infoEl).find('.value').text());
    });

    if (!matchNumber && !teamHome && !teamAway) return;

    games.push({
      matchNumber,
      teamHome: info['Squadra di casa'] || teamHome,
      teamAway: info['Squadra ospite'] || teamAway,
      scoreHome,
      scoreAway,
      scheduledAt: parseItalianDateTime(dateText, timeText),
      venue: cleanText(info['Campo di gioco'] || ''),
      referee1: officialValue(info['1° Arbitro']),
      referee2: officialValue(info['2° Arbitro']),
      referee3: officialValue(info['3° Arbitro']),
      statusText,
      status: deriveStatus(statusText, scoreHome, scoreAway)
    });
  });

  return {
    games,
    giornate: [...giornate].sort((a, b) => a - b),
    giornateRefs
  };
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchGiornataHtml(params, giornata, { fetchImpl = fetch, codiceAr } = {}) {
  const url = buildGiornataUrl(params, giornata, { codiceAr });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RapportiArbitrali/1.0)',
        Accept: 'text/html'
      }
    });
  } catch (err) {
    throw new HttpError(502, `Sito FIP non raggiungibile (giornata ${giornata}): ${err.name === 'AbortError' ? 'timeout' : err.message}`);
  } finally {
    clearTimeout(timer);
  }

  // I redirect vengono seguiti da fetch: verifichiamo che l'URL finale resti
  // su un host consentito (protezione SSRF).
  const finalHost = new URL(response.url || url).hostname;
  if (!ALLOWED_HOSTS.has(finalHost)) {
    throw new HttpError(502, 'Il sito FIP ha rediretto verso un host non consentito.');
  }
  if (!response.ok) {
    throw new HttpError(502, `Il sito FIP ha risposto ${response.status} per la giornata ${giornata}.`);
  }
  return response.text();
}

// Numerazione continua quando esistono andata e ritorno: la FIP le numera
// entrambe 1..N, qui diventano 1..N (andata) e N+1..2N (ritorno) così il
// calendario mostra le 22 giornate reali invece di 11 sovrapposte. Le
// competizioni a girone unico (nessuna etichetta andata/ritorno) restano 1..N.
export function assignContinuousMatchdays(refs) {
  const groups = { andata: [], ritorno: [], none: [] };
  for (const ref of refs) {
    if (ref.leg === 'andata') groups.andata.push(ref);
    else if (ref.leg === 'ritorno') groups.ritorno.push(ref);
    else groups.none.push(ref);
  }
  const numbered = [];
  let offset = 0;
  for (const key of ['andata', 'ritorno', 'none']) {
    const group = groups[key].slice().sort((a, b) => a.giornata - b.giornata);
    if (!group.length) continue;
    for (const ref of group) numbered.push({ ...ref, matchday: ref.giornata + offset });
    offset += group[group.length - 1].giornata;
  }
  return numbered;
}

// Scarica e interpreta tutte le giornate di una competizione (andata + ritorno),
// con una pausa tra le richieste per non martellare il sito FIP.
export async function fetchAllGiornate(params, { fetchImpl = fetch, onProgress = null } = {}) {
  const firstAr = params.codice_ar !== undefined && params.codice_ar !== '' ? String(params.codice_ar) : null;
  const firstHtml = await fetchGiornataHtml(params, 1, { fetchImpl });
  const firstPage = parseResultsPage(firstHtml);

  const refs = firstPage.giornateRefs.length
    ? firstPage.giornateRefs
    : [{ codiceAr: firstAr, giornata: 1, leg: null }];
  const numbered = assignContinuousMatchdays(refs);

  const results = [];
  for (const ref of numbered) {
    let games;
    // Riusa la prima pagina già scaricata quando coincide (evita una richiesta).
    if ((ref.codiceAr ?? null) === firstAr && ref.giornata === 1) {
      games = firstPage.games;
    } else {
      await delay(REQUEST_DELAY_MS);
      const html = await fetchGiornataHtml(params, ref.giornata, { fetchImpl, codiceAr: ref.codiceAr });
      games = parseResultsPage(html).games;
    }
    results.push({ giornata: ref.matchday, leg: ref.leg, games });
    if (onProgress) onProgress(results.length, numbered.length);
  }

  return results;
}
