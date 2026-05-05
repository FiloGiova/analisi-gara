#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  COMMON_MATCH_CHARACTERISTICS,
  EVALUATION_SECTIONS,
  createEmptyReport,
  deriveSeason
} from '../shared/reportTemplate.js';
import { config } from '../src/config.js';
import { initializeDatabase, getDb, closeDatabase } from '../src/database/connection.js';
import { normalizeReportPayload } from '../src/services/reportService.js';
import { getPdfFileInfo } from '../src/services/pdfService.js';

const MONTHS = {
  gen: '01', feb: '02', mar: '03', apr: '04', mag: '05', giu: '06',
  lug: '07', ago: '08', set: '09', ott: '10', nov: '11', dic: '12'
};

const COMPETITION_MAP = new Map([
  ['D', 'DR1'],
  ['DR1', 'DR1'],
  ['DIVISIONE REGIONALE 1', 'DR1'],
  ['SERIE C', 'Serie C'],
  ['C', 'Serie C']
]);

function usage() {
  console.log(`Uso:
  npm run import:legacy-pdfs -- --dry-run file1.pdf file2.pdf
  npm run import:legacy-pdfs -- --commit file1.pdf file2.pdf

Opzioni:
  --dry-run                 Mostra cosa importerebbe, senza scrivere. Default.
  --commit                  Scrive DB e copia PDF nello storage.
  --create-missing-referees Crea arbitri mancanti dall'intestazione PDF.
  --default-vote=N          Usa N come voto se il PDF storico non lo contiene.
  --competition=VALORE      Forza il campionato app, es. DR1 o "Serie C".
`);
}

function parseArgs(argv) {
  const options = { dryRun: true, createMissingReferees: false, defaultVote: '', competition: '' };
  const files = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--commit') options.dryRun = false;
    else if (arg === '--create-missing-referees') options.createMissingReferees = true;
    else if (arg.startsWith('--default-vote=')) options.defaultVote = arg.slice('--default-vote='.length).trim();
    else if (arg.startsWith('--competition=')) options.competition = arg.slice('--competition='.length).trim();
    else if (arg.startsWith('-')) throw new Error(`Opzione sconosciuta: ${arg}`);
    else files.push(arg);
  }
  if (!files.length) throw new Error('Indica almeno un PDF da importare.');
  if (options.defaultVote && !/^\d{1,2}$/.test(options.defaultVote)) {
    throw new Error('--default-vote deve essere un numero intero di massimo 2 cifre.');
  }
  return { options, files };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function tokenKey(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean).sort().join(' ');
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseLegacyDate(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d{1,2})-([a-z]{3})-(\d{2,4})$/);
  if (!match) return '';
  const month = MONTHS[match[2]];
  if (!month) return '';
  const yearNum = Number(match[3]);
  const year = yearNum < 100 ? 2000 + yearNum : yearNum;
  return `${year}-${month}-${match[1].padStart(2, '0')}`;
}

function parseItalianDate(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function mapCompetition(value, forced = '') {
  if (forced) return forced;
  const key = String(value || '').trim().toUpperCase();
  return COMPETITION_MAP.get(key) || String(value || '').trim();
}

function splitRefereeName(fullName) {
  const parts = compact(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  const firstTokenLooksSurname = parts[0] === parts[0].toUpperCase() && parts[1] !== parts[1].toUpperCase();
  if (firstTokenLooksSurname) return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) };
}

function selectedOption(line, options) {
  const noSpaces = String(line || '').replace(/\s+/g, '');
  for (const option of [...options].sort((a, b) => b.length - a.length)) {
    if (noSpaces.includes(`X${option.replace(/\s+/g, '')}`)) return option;
  }
  return '';
}

function normalizeRatingValue(value) {
  const clean = normalizeText(value);
  if (clean === 'non valutabile') return 'N/V';
  if (clean === 'di qualita') return 'Di qualità';
  if (clean === 'migliorabile') return 'Migliorabile';
  if (clean === 'standard') return 'Standard';
  if (clean === 'eccellente') return 'Eccellente';
  if (clean === 'normale') return 'Normale';
  if (clean === 'impegnativa') return 'Impegnativa';
  if (clean === 'difficile') return 'Difficile';
  return '';
}

function plainOption(line, options) {
  const value = normalizeRatingValue(line);
  if (!value) return '';
  return options.includes(value) ? value : '';
}

function nextOptionLine(lines, start, options, maxLookahead = 20) {
  for (let i = Math.max(0, start); i < Math.min(lines.length, start + maxLookahead); i += 1) {
    const value = selectedOption(lines[i], options);
    if (value) return { index: i, value };
  }
  return { index: -1, value: '' };
}

function nextPlainOptionLine(lines, start, options, maxLookahead = 10) {
  for (let i = Math.max(0, start); i < Math.min(lines.length, start + maxLookahead); i += 1) {
    const value = plainOption(lines[i], options);
    if (value) return { index: i, value };
  }
  return { index: -1, value: '' };
}

function findLine(lines, pattern, start = 0) {
  return lines.findIndex((line, index) => index >= start && pattern.test(line));
}

function textBetween(lines, start, end) {
  if (start < 0 || end <= start) return '';
  return lines.slice(start, end).map(compact).filter(Boolean).join('\n').trim();
}

function cleanImportedLines(lines) {
  return lines
    .map(compact)
    .filter(Boolean)
    .filter((line) => !/^Pagina \d+ di \d+$/i.test(line))
    .filter((line) => !/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}Data stampa:$/i.test(line));
}

function noteAfter(lines, startPattern, endPattern) {
  const start = findLine(lines, startPattern);
  if (start < 0) return '';
  const note = findLine(lines, /^Note\b/i, start);
  if (note < 0) return '';
  const end = findLine(lines, endPattern, note + 1);
  return cleanImportedLines(lines.slice(note + 1, end > note ? end : lines.length)).join('\n');
}

function splitPerformanceComments(lines, start, end) {
  const block = lines.slice(start, end).map(compact).filter(Boolean);
  if (!block.length) return { fitness: '', match: '' };
  const matchStart = block.findIndex((line) => /^(risultato|gara|partita)\b/i.test(line));
  if (matchStart > 0) {
    return { fitness: block.slice(0, matchStart).join('\n'), match: block.slice(matchStart).join('\n') };
  }
  return { fitness: block[0] || '', match: block.slice(1).join('\n') };
}

function parseHeader(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (/RAPPORTO PRESTAZIONE ARBITRALE/i.test(text)) return parseStructuredHeader(lines, text);

  const flat = compact(text);
  const observer = flat.match(/Osservatore:\s*(.*?)\s*Data:\s*([0-9]{1,2}-[a-z]{3}-[0-9]{2,4})/i);
  const first = flat.match(/1° arbitro:\s*(.*?)\s*Campionato:\s*([A-Za-z0-9 /]+?)\s*Gara:\s*([0-9]+)/i);
  const second = flat.match(/2° arbitro\s*:?\s*(.*?)\s*Squadre:\s*(.*?)\s*-\s*(.*?)\s*Risultato Finale:\s*([0-9]+)\s*-\s*([0-9]+)/i);
  if (!observer || !first || !second) throw new Error('Intestazione PDF non riconosciuta.');
  return {
    observerName: compact(observer[1]),
    reportDate: parseLegacyDate(observer[2]),
    firstRefereeName: compact(first[1]),
    competitionRaw: compact(first[2]),
    matchNumber: compact(first[3]),
    secondRefereeName: compact(second[1]),
    teamHome: compact(second[2]),
    teamAway: compact(second[3]),
    scoreHome: compact(second[4]),
    scoreAway: compact(second[5]),
    rawText: text
  };
}

function parseStructuredHeader(lines, text) {
  const evaluatorLine = lines.find((line) => /^VALUTATORE:DATA:/i.test(line)) || '';
  const evaluator = evaluatorLine.match(/^VALUTATORE:DATA:(.+?)(\d{2}\/\d{2}\/\d{4})$/i);
  const dateIdx = lines.findIndex((line, index) => index < 20 && /^\d{2}\/\d{2}\/\d{4}$/.test(line));
  const squadsIdx = findLine(lines, /^SQUADRE:/i);
  const thirdRefIdx = findLine(lines, /^3° ARBITRO:/i);
  const competitionIdx = findLine(lines, /^CAMPIONATO:/i);
  const scoreLine = squadsIdx >= 0 ? lines[squadsIdx + 4] || '' : '';
  const score = scoreLine.match(/(\d+)\s*-\s*(\d+)/);
  if (!evaluator || dateIdx < 1 || squadsIdx < 0 || thirdRefIdx < 0 || competitionIdx < 0 || !score) {
    throw new Error('Intestazione PDF non riconosciuta.');
  }

  return {
    observerName: compact(evaluator[1]),
    reportDate: parseItalianDate(lines[dateIdx]),
    firstRefereeName: compact(lines[dateIdx - 1]),
    competitionRaw: compact(lines[competitionIdx + 1]),
    matchNumber: compact(lines[competitionIdx + 2]),
    secondRefereeName: compact(lines[squadsIdx + 1]),
    teamHome: compact(lines[thirdRefIdx + 1]),
    teamAway: compact(lines[squadsIdx + 3]),
    scoreHome: score[1],
    scoreAway: score[2],
    rawText: text,
    format: 'structured'
  };
}

function inferRole(filePath, header) {
  const rawBase = path.basename(filePath, path.extname(filePath));
  const base = normalizeText(rawBase);
  if (/\barbitro\s*1\b/i.test(base) || /\barbitro1\b/i.test(base)) return 'first';
  if (/\barbitro\s*2\b/i.test(base) || /\barbitro2\b/i.test(base)) return 'second';
  if (/(^|[^0-9])1$/i.test(rawBase)) return 'first';
  if (/(^|[^0-9])2$/i.test(rawBase)) return 'second';
  const first = splitRefereeName(header.firstRefereeName);
  const second = splitRefereeName(header.secondRefereeName);
  if (first.lastName && base.includes(normalizeText(first.lastName))) return 'first';
  if (second.lastName && base.includes(normalizeText(second.lastName))) return 'second';
  const headerRef = compact((header.rawText.match(/ARBITRO\s*:?\s*([^\n]+)/i) || [])[1] || '');
  if (tokenKey(headerRef) === tokenKey(header.firstRefereeName)) return 'first';
  if (tokenKey(headerRef) === tokenKey(header.secondRefereeName)) return 'second';
  return '';
}

function parseStructuredEvaluation(lines, defaultVote) {
  const evaluation = createEmptyReport().evaluations.first;
  const matchCharacteristics = createEmptyReport().matchCharacteristics;

  matchCharacteristics.ratings.difficulty = nextPlainOptionLine(
    lines,
    findLine(lines, /^1\s+CARATTERISTICHE/i),
    COMMON_MATCH_CHARACTERISTICS.groups[0].options
  ).value;
  matchCharacteristics.comment = noteAfter(lines, /^1\s+CARATTERISTICHE/i, /^2\s+STATO/i) || 'Importato da PDF storico.';

  evaluation.sections.fitness.ratings.level = nextPlainOptionLine(
    lines,
    findLine(lines, /^2\s+STATO/i),
    EVALUATION_SECTIONS[0].groups[0].options
  ).value;
  evaluation.sections.fitness.comment = noteAfter(lines, /^2\s+STATO/i, /^3\s+CONDUZIONE/i) || 'Importato da PDF storico.';

  const management = evaluation.sections.management.ratings;
  management.leadership = nextPlainOptionLine(lines, findLine(lines, /^3\.1\b/), EVALUATION_SECTIONS[1].groups[0].options).value;
  management.teamwork = nextPlainOptionLine(lines, findLine(lines, /^3\.2\b/), EVALUATION_SECTIONS[1].groups[1].options).value;
  management.consistency = nextPlainOptionLine(lines, findLine(lines, /^3\.3\b/), EVALUATION_SECTIONS[1].groups[2].options).value;
  evaluation.sections.management.comment = noteAfter(lines, /^3\s+CONDUZIONE/i, /^4\s+DISCIPLINA/i) || 'Importato da PDF storico.';

  const discipline = evaluation.sections.discipline.ratings;
  discipline.conflictManagement = nextPlainOptionLine(lines, findLine(lines, /^4\.1\b/), EVALUATION_SECTIONS[2].groups[0].options).value;
  discipline.measures = nextPlainOptionLine(lines, findLine(lines, /^4\.2\b/), EVALUATION_SECTIONS[2].groups[1].options).value;
  evaluation.sections.discipline.comment = noteAfter(lines, /^4\s+DISCIPLINA/i, /^5\s+TECNICA/i) || 'Importato da PDF storico.';

  const technique = evaluation.sections.technique.ratings;
  technique.travel = nextPlainOptionLine(lines, findLine(lines, /^5\.1\.1\b/), EVALUATION_SECTIONS[3].groups[0].options).value;
  technique.timingRules = nextPlainOptionLine(lines, findLine(lines, /^5\.1\.2\b/), EVALUATION_SECTIONS[3].groups[1].options).value;
  technique.otherViolations = nextPlainOptionLine(lines, findLine(lines, /^5\.1\.3\b/), EVALUATION_SECTIONS[3].groups[2].options).value;
  technique.shootingFouls = nextPlainOptionLine(lines, findLine(lines, /^5\.2\.1\b/), EVALUATION_SECTIONS[3].groups[3].options).value;
  technique.contactResponsibility = nextPlainOptionLine(lines, findLine(lines, /^5\.2\.2\b/), EVALUATION_SECTIONS[3].groups[4].options).value;
  technique.rebound = nextPlainOptionLine(lines, findLine(lines, /^5\.3\.1\b/), EVALUATION_SECTIONS[3].groups[5].options).value;
  technique.screensCuts = nextPlainOptionLine(lines, findLine(lines, /^5\.3\.2\b/), EVALUATION_SECTIONS[3].groups[6].options).value;
  technique.unsportsmanlike = nextPlainOptionLine(lines, findLine(lines, /^5\.4\b/), EVALUATION_SECTIONS[3].groups[7].options).value;
  technique.simulations = nextPlainOptionLine(lines, findLine(lines, /^5\.5\b/), EVALUATION_SECTIONS[3].groups[8].options).value;
  evaluation.sections.technique.comment = noteAfter(lines, /^5\s+TECNICA/i, /^6\s+AMMINISTRAZIONE/i) || 'Importato da PDF storico.';

  evaluation.sections.administration.ratings.level = nextPlainOptionLine(
    lines,
    findLine(lines, /^6\s+AMMINISTRAZIONE/i),
    EVALUATION_SECTIONS[4].groups[0].options
  ).value;
  evaluation.sections.communication.ratings.level = nextPlainOptionLine(
    lines,
    findLine(lines, /^7\s+COMUNICAZIONE/i),
    EVALUATION_SECTIONS[5].groups[0].options
  ).value;
  const mechanics = evaluation.sections.mechanics.ratings;
  mechanics.gameReading = nextPlainOptionLine(lines, findLine(lines, /^8\.1\b/), EVALUATION_SECTIONS[6].groups[0].options).value;
  mechanics.responsibilities = nextPlainOptionLine(lines, findLine(lines, /^8\.2\b/), EVALUATION_SECTIONS[6].groups[1].options).value;
  evaluation.sections.mechanics.comment = noteAfter(lines, /^8\s+MECCANICA/i, /^9\s+CONCLUSIONI/i) || 'Importato da PDF storico.';

  const finalHint = findLine(lines, /Indicare eventuali punti di forza/i);
  const errorsStart = findLine(lines, /^EVENTUALI ERRORI TECNICI/i, finalHint);
  evaluation.globalJudgement = cleanImportedLines(lines.slice(finalHint + 1, errorsStart)).join('\n') || 'Importato da PDF storico.';
  const errorsHint = findLine(lines, /Indicare tipo di errore/i, errorsStart);
  evaluation.technicalErrors = cleanImportedLines(lines.slice(errorsHint + 1)).join('\n') || 'NO';
  evaluation.vote = defaultVote || '';

  return { evaluation, matchCharacteristics };
}

function parsePdfEvaluation(lines, defaultVote) {
  if (findLine(lines, /^RAPPORTO PRESTAZIONE ARBITRALE$/i) >= 0) {
    return parseStructuredEvaluation(lines, defaultVote);
  }

  const evaluation = createEmptyReport().evaluations.first;
  const matchCharacteristics = createEmptyReport().matchCharacteristics;

  const matchRating = nextOptionLine(lines, findLine(lines, /^1\)/), COMMON_MATCH_CHARACTERISTICS.groups[0].options);
  if (matchRating.value) matchCharacteristics.ratings.difficulty = matchRating.value;

  const fitnessRating = nextOptionLine(lines, findLine(lines, /^2\)/), EVALUATION_SECTIONS[0].groups[0].options);
  if (fitnessRating.value) evaluation.sections.fitness.ratings.level = fitnessRating.value;

  const perfStart = findLine(lines, /VALUTAZIONE PRESTAZIONE ARBITRALE/i);
  const conductionStart = findLine(lines, /^3\)/);
  const comments = splitPerformanceComments(lines, perfStart + 1, conductionStart);
  evaluation.sections.fitness.comment = comments.fitness;
  matchCharacteristics.comment = comments.match || comments.fitness || 'Importato da PDF storico.';

  const management = evaluation.sections.management.ratings;
  management.leadership = nextOptionLine(lines, findLine(lines, /3\.1/), EVALUATION_SECTIONS[1].groups[0].options).value;
  management.teamwork = nextOptionLine(lines, findLine(lines, /3\.2/), EVALUATION_SECTIONS[1].groups[1].options).value;
  management.consistency = nextOptionLine(lines, findLine(lines, /3\.3/), EVALUATION_SECTIONS[1].groups[2].options).value;

  const discipline = evaluation.sections.discipline.ratings;
  discipline.conflictManagement = nextOptionLine(lines, findLine(lines, /4\.1/), EVALUATION_SECTIONS[2].groups[0].options).value;
  discipline.measures = nextOptionLine(lines, findLine(lines, /4\.2/), EVALUATION_SECTIONS[2].groups[1].options).value;

  const technique = evaluation.sections.technique.ratings;
  technique.travel = nextOptionLine(lines, findLine(lines, /5\.1\.1/), EVALUATION_SECTIONS[3].groups[0].options).value;
  const timingStart = findLine(lines, /5\.1\.2/);
  const timingRating = nextOptionLine(lines, timingStart, EVALUATION_SECTIONS[3].groups[1].options, 20);
  technique.timingRules = timingRating.value;
  technique.otherViolations = nextOptionLine(lines, findLine(lines, /5\.1\.3/), EVALUATION_SECTIONS[3].groups[2].options).value;
  technique.shootingFouls = nextOptionLine(lines, findLine(lines, /5\.2\.1/), EVALUATION_SECTIONS[3].groups[3].options).value;
  technique.contactResponsibility = nextOptionLine(lines, findLine(lines, /5\.2\.2/), EVALUATION_SECTIONS[3].groups[4].options).value;
  technique.rebound = nextOptionLine(lines, findLine(lines, /5\.3\.1/), EVALUATION_SECTIONS[3].groups[5].options).value;
  technique.screensCuts = nextOptionLine(lines, findLine(lines, /5\.3\.2/), EVALUATION_SECTIONS[3].groups[6].options).value;
  technique.unsportsmanlike = nextOptionLine(lines, findLine(lines, /5\.4/), EVALUATION_SECTIONS[3].groups[7].options).value;
  const simulationsRating = nextOptionLine(lines, findLine(lines, /5\.5/), EVALUATION_SECTIONS[3].groups[8].options);
  technique.simulations = simulationsRating.value;

  const techniqueTitle = findLine(lines, /^5\)/);
  const administrationStart = findLine(lines, /^6\)/);
  const techniqueIntro = textBetween(lines, techniqueTitle + 1, timingRating.index);
  const techniqueTail = textBetween(lines, simulationsRating.index + 1, administrationStart);
  const techniqueComment = [techniqueIntro, techniqueTail].filter(Boolean).join('\n');
  evaluation.sections.technique.comment = techniqueComment || 'Importato da PDF storico.';
  evaluation.sections.management.comment = techniqueIntro || techniqueComment || 'Importato da PDF storico.';
  evaluation.sections.discipline.comment = techniqueIntro || techniqueComment || 'Importato da PDF storico.';

  evaluation.sections.administration.ratings.level = nextOptionLine(lines, administrationStart, EVALUATION_SECTIONS[4].groups[0].options).value;
  evaluation.sections.communication.ratings.level = nextOptionLine(lines, findLine(lines, /^7\)/), EVALUATION_SECTIONS[5].groups[0].options).value;
  const mechanics = evaluation.sections.mechanics.ratings;
  mechanics.gameReading = nextOptionLine(lines, findLine(lines, /8\.1/), EVALUATION_SECTIONS[6].groups[0].options).value;
  mechanics.responsibilities = nextOptionLine(lines, findLine(lines, /8\.2/), EVALUATION_SECTIONS[6].groups[1].options).value;

  const globalStart = findLine(lines, /^GIUDIZIO GLOBALE/i);
  const errorsStart = findLine(lines, /^EVENTUALI ERRORI TECNICI/i, globalStart);
  const tail = lines.slice(errorsStart + 1).map(compact).filter(Boolean);
  evaluation.technicalErrors = tail.at(-1) || 'NO';
  evaluation.globalJudgement = tail.slice(0, -1).join('\n') || 'Importato da PDF storico.';
  evaluation.sections.mechanics.comment = evaluation.globalJudgement;
  evaluation.vote = defaultVote || '';

  return { evaluation, matchCharacteristics };
}

async function parsePdf(filePath, options) {
  const absolutePath = path.resolve(filePath);
  const data = await pdfParse(fs.readFileSync(absolutePath));
  const text = data.text || '';
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = parseHeader(text);
  const role = inferRole(absolutePath, header);
  if (!role) throw new Error(`Non riesco a determinare il ruolo dal nome file: ${filePath}`);
  return { path: absolutePath, role, header, ...parsePdfEvaluation(lines, options.defaultVote) };
}

function findUserByDisplayName(name) {
  const rows = getDb().prepare('SELECT id, username, display_name, role FROM users').all();
  const wanted = normalizeText(name);
  const wantedTokens = tokenKey(name);
  return rows.find((row) => normalizeText(row.display_name) === wanted) ||
    rows.find((row) => tokenKey(row.display_name) === wantedTokens) ||
    null;
}

function findRefereeByName(name) {
  const rows = getDb().prepare('SELECT id, first_name, last_name FROM referees').all();
  const wantedTokens = tokenKey(name);
  return rows.find((row) => tokenKey(`${row.first_name} ${row.last_name}`) === wantedTokens) ||
    rows.find((row) => tokenKey(`${row.last_name} ${row.first_name}`) === wantedTokens) ||
    null;
}

function createRefereeFromName(name, competition, season) {
  const split = splitRefereeName(name);
  const result = getDb()
    .prepare('INSERT INTO referees (first_name, last_name, category, active) VALUES (?, ?, ?, 1)')
    .run(split.firstName || split.lastName, split.lastName || split.firstName, competition);
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO referee_season_categories (referee_id, sport_season, category, active)
       VALUES (?, ?, ?, 1)`
    )
    .run(result.lastInsertRowid, season, competition);
  return { id: result.lastInsertRowid, first_name: split.firstName, last_name: split.lastName };
}

function ensureReferee(name, competition, season, options) {
  const existing = findRefereeByName(name);
  if (existing || options.dryRun) return existing;
  if (!options.createMissingReferees) return null;
  return createRefereeFromName(name, competition, season);
}

function buildReportPayload(group, options) {
  const firstParsed = group.items.find((item) => item.role === 'first');
  const secondParsed = group.items.find((item) => item.role === 'second');
  const sample = group.items[0];
  const competition = mapCompetition(sample.header.competitionRaw, options.competition);
  const season = deriveSeason(sample.header.reportDate);
  const payload = createEmptyReport();
  Object.assign(payload, {
    status: 'final',
    observerName: sample.header.observerName,
    reportDate: sample.header.reportDate,
    matchNumber: sample.header.matchNumber,
    competition,
    teamHome: sample.header.teamHome,
    teamAway: sample.header.teamAway,
    scoreHome: sample.header.scoreHome,
    scoreAway: sample.header.scoreAway,
    firstRefereeName: sample.header.firstRefereeName,
    secondRefereeName: sample.header.secondRefereeName,
    matchCharacteristics: sample.matchCharacteristics
  });
  if (firstParsed) payload.evaluations.first = firstParsed.evaluation;
  if (secondParsed) payload.evaluations.second = secondParsed.evaluation;

  const observer = findUserByDisplayName(payload.observerName);
  const firstReferee = ensureReferee(payload.firstRefereeName, competition, season, options);
  const secondReferee = ensureReferee(payload.secondRefereeName, competition, season, options);
  payload.firstRefereeId = firstReferee?.id || null;
  payload.secondRefereeId = secondReferee?.id || null;

  return { payload: normalizeReportPayload(payload), observer, firstReferee, secondReferee, season, competition };
}

function duplicateReport(payload) {
  return getDb()
    .prepare(
      `SELECT id FROM reports
       WHERE match_number = ? AND report_date = ? AND observer_name = ?`
    )
    .get(payload.matchNumber, payload.reportDate, payload.observerName);
}

function insertReport({ payload, observer, season }) {
  const result = getDb()
    .prepare(
      `INSERT INTO reports (
         status, observer_name, report_date, match_number, competition,
         team_home, team_away, score_home, score_away,
         first_referee_id, first_referee_name, second_referee_id, second_referee_name,
         first_referee_vote, second_referee_vote, payload_json, created_by, sport_season, finalized_at
       )
       VALUES ('final', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(
      payload.observerName,
      payload.reportDate,
      payload.matchNumber,
      payload.competition,
      payload.teamHome,
      payload.teamAway,
      payload.scoreHome,
      payload.scoreAway,
      payload.firstRefereeId,
      payload.firstRefereeName,
      payload.secondRefereeId,
      payload.secondRefereeName,
      payload.evaluations.first.vote,
      payload.evaluations.second.vote,
      JSON.stringify({ ...payload, status: 'final' }),
      observer?.id || null,
      season
    );
  return result.lastInsertRowid;
}

function copyPdfExports(reportId, payload, season, items) {
  const report = { id: reportId, sportSeason: season, data: payload };
  for (const item of items) {
    const info = getPdfFileInfo(report, item.role);
    fs.mkdirSync(info.dir, { recursive: true });
    fs.copyFileSync(item.path, info.filePath);
    getDb()
      .prepare('INSERT INTO exports (report_id, referee_role, file_name, file_path) VALUES (?, ?, ?, ?)')
      .run(reportId, item.role, info.fileName, info.filePath);
  }
}

function printPlan(group, built, duplicate) {
  const { payload, observer, firstReferee, secondReferee, season } = built;
  console.log(`\nGara ${payload.matchNumber} - ${payload.teamHome} vs ${payload.teamAway} (${payload.scoreHome}-${payload.scoreAway})`);
  console.log(`  Data/stagione: ${payload.reportDate} / ${season}`);
  console.log(`  Campionato: ${payload.competition}`);
  console.log(`  Osservatore: ${payload.observerName} -> ${observer ? `${observer.display_name} (#${observer.id})` : 'NON TROVATO'}`);
  console.log(`  1° arbitro: ${payload.firstRefereeName} -> ${firstReferee ? `#${firstReferee.id}` : 'NON TROVATO'}`);
  console.log(`  2° arbitro: ${payload.secondRefereeName} -> ${secondReferee ? `#${secondReferee.id}` : 'NON TROVATO'}`);
  console.log(`  PDF: ${group.items.map((item) => `${item.role}:${path.basename(item.path)}`).join(', ')}`);
  console.log(`  Voti: ${payload.evaluations.first.vote || '-'} / ${payload.evaluations.second.vote || '-'}`);
  if (duplicate) console.log(`  Stato: gia presente come report #${duplicate.id}, verrebbe saltato.`);
}

async function main() {
  const { options, files } = parseArgs(process.argv.slice(2));
  initializeDatabase();

  const parsed = [];
  for (const file of files) parsed.push(await parsePdf(file, options));

  const groups = new Map();
  for (const item of parsed) {
    const key = `${item.header.reportDate}|${item.header.matchNumber}|${item.header.observerName}`;
    if (!groups.has(key)) groups.set(key, { key, items: [] });
    groups.get(key).items.push(item);
  }

  let imported = 0;
  let skipped = 0;
  for (const group of groups.values()) {
    const built = buildReportPayload(group, options);
    const duplicate = duplicateReport(built.payload);
    printPlan(group, built, duplicate);
    if (duplicate) {
      skipped += 1;
      continue;
    }
    if (!built.observer) {
      console.log('  ERRORE: osservatore non trovato nel DB.');
      skipped += 1;
      continue;
    }
    if (!built.firstReferee || !built.secondReferee) {
      console.log('  ERRORE: arbitri non trovati nel DB. Usa --create-missing-referees se vuoi crearli.');
      skipped += 1;
      continue;
    }
    if (options.dryRun) {
      console.log('  Dry-run: nessuna scrittura.');
      continue;
    }
    const reportId = insertReport(built);
    copyPdfExports(reportId, built.payload, built.season, group.items);
    console.log(`  Importato report #${reportId} in ${config.outputDir}.`);
    imported += 1;
  }

  console.log(`\nFine. Importati: ${imported}. Saltati: ${skipped}. Modalita: ${options.dryRun ? 'dry-run' : 'commit'}.`);
  closeDatabase();
}

main().catch((error) => {
  console.error(`Errore import: ${error.message}`);
  closeDatabase();
  process.exit(1);
});
