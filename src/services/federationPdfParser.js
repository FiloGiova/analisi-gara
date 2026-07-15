import { PDFParse } from 'pdf-parse';
import {
  COMMON_MATCH_CHARACTERISTICS,
  EVALUATION_SECTIONS,
  createEmptyReport,
  deriveSeason
} from '../../shared/reportTemplate.js';

const COMPETITION_MAP = new Map([
  ['D', 'DR1'],
  ['DR1', 'DR1'],
  ['DIVISIONE REGIONALE 1', 'DR1'],
  ['DIVISIONE REGIONALE1', 'DR1'],
  ['SERIE C', 'Serie C'],
  ['C', 'Serie C']
]);

const POTENTIAL_LEVELS = ['Nessuna', 'Bassa', 'Media', 'Alta'];

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: Uint8Array.from(buffer) });
  try {
    return await parser.getText({ pageJoiner: '\n' });
  } finally {
    await parser.destroy();
  }
}

export class FederationPdfParseError extends Error {
  constructor(message, code = 'invalid_pdf_template') {
    super(message);
    this.name = 'FederationPdfParseError';
    this.code = code;
  }
}

export function normalizeFederationText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function federationNameKey(value) {
  return normalizeFederationText(value).split(/\s+/).filter(Boolean).sort().join(' ');
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseItalianDate(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function mapCompetition(value) {
  const clean = compact(value);
  return COMPETITION_MAP.get(clean.toUpperCase()) || clean;
}

function normalizeRatingValue(value) {
  const clean = normalizeFederationText(value);
  if (clean === 'non valutabile' || clean === 'n v') return 'N/V';
  if (clean === 'di qualita') return 'Di qualità';
  if (clean === 'migliorabile') return 'Migliorabile';
  if (clean === 'standard') return 'Standard';
  if (clean === 'eccellente') return 'Eccellente';
  if (clean === 'normale') return 'Normale';
  if (clean === 'impegnativa') return 'Impegnativa';
  if (clean === 'difficile') return 'Difficile';
  return '';
}

function findLine(lines, pattern, start = 0, end = lines.length) {
  for (let index = Math.max(0, start); index < Math.min(lines.length, end); index += 1) {
    if (pattern.test(lines[index])) return index;
  }
  return -1;
}

function isPageNoise(line) {
  return /^Pagina \d+ di \d+(?:\s+.*Data stampa:)?$/i.test(line) ||
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*Data stampa:$/i.test(line) ||
    /^Data stampa:/i.test(line);
}

function cleanLines(lines) {
  return lines.map(compact).filter(Boolean).filter((line) => !isPageNoise(line));
}

function joinPdfTextLines(lines) {
  return cleanLines(lines).reduce((text, line) => {
    if (!text) return line;
    return text.endsWith('-') ? `${text}${line}` : `${text} ${line}`;
  }, '').trim();
}

function textBetween(lines, start, end) {
  if (start < 0 || end < 0 || end <= start) return '';
  return joinPdfTextLines(lines.slice(start, end));
}

export function federationTextSimilarity(first, second) {
  const left = normalizeFederationText(first);
  const right = normalizeFederationText(second);
  if (left === right) return 1;
  if (!left || !right) return 0;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let previous = Array.from({ length: shorter.length + 1 }, (_, index) => index);

  for (let row = 1; row <= longer.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= shorter.length; column += 1) {
      const cost = longer[row - 1] === shorter[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost
      );
    }
    previous = current;
  }

  return 1 - previous[shorter.length] / longer.length;
}

function noteBetween(lines, sectionPattern, nextSectionPattern) {
  const section = findLine(lines, sectionPattern);
  if (section < 0) return '';
  const end = findLine(lines, nextSectionPattern, section + 1);
  const note = findLine(lines, /^Note$/i, section + 1, end < 0 ? lines.length : end);
  if (note < 0) return '';
  return textBetween(lines, note + 1, end < 0 ? lines.length : end);
}

function ratingAfter(lines, headingPattern, options, maxLookahead = 6) {
  const heading = findLine(lines, headingPattern);
  if (heading < 0) return '';
  const end = Math.min(lines.length, heading + maxLookahead + 1);
  for (let index = heading + 1; index < end; index += 1) {
    const value = normalizeRatingValue(lines[index]);
    if (options.includes(value)) return value;
  }
  return '';
}

function parseStructuredHeader(lines, text) {
  if (!/RAPPORTO PRESTAZIONE ARBITRALE/i.test(text)) {
    throw new FederationPdfParseError('Template PDF federale non riconosciuto.');
  }

  const evaluatorLine = lines.find((line) => /^VALUTATORE:\s*DATA:/i.test(line)) || '';
  const evaluator = evaluatorLine.match(/^VALUTATORE:\s*DATA:\s*(.+?)\s*(\d{1,2}\/\d{1,2}\/\d{4})$/i);
  const dateIndex = lines.findIndex((line, index) => index < 35 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line));
  const squadsIndex = findLine(lines, /^SQUADRE:/i, 0, 45);
  const thirdRefereeIndex = findLine(lines, /^3°\s*ARBITRO:/i, 0, 45);
  const competitionIndex = findLine(lines, /^CAMPIONATO:/i, 0, 45);
  const targetLine = lines.find((line) => /^ARBITRO:/i.test(line)) || '';
  const targetMatch = targetLine.match(/^ARBITRO:\s*(.+)$/i);
  const scoreLine = squadsIndex >= 0 ? lines[squadsIndex + 4] || '' : '';
  const score = scoreLine.match(/(\d+)\s*-\s*(\d+)/);

  if (!evaluator || dateIndex < 1 || squadsIndex < 0 || thirdRefereeIndex < 0 || competitionIndex < 0 || !targetMatch || !score) {
    throw new FederationPdfParseError('Intestazione PDF federale incompleta o non riconosciuta.');
  }

  const inlineCompetition = competitionIndex >= 0
    ? compact(lines[competitionIndex].replace(/^CAMPIONATO:\s*/i, ''))
    : '';
  const competitionValue = inlineCompetition || lines[competitionIndex + 1];
  const matchNumberValue = lines[competitionIndex + (inlineCompetition ? 1 : 2)];
  const header = {
    observerName: compact(evaluator[1]),
    reportDate: parseItalianDate(lines[dateIndex]),
    firstRefereeName: compact(lines[dateIndex - 1]),
    secondRefereeName: compact(lines[squadsIndex + 1]),
    teamHome: compact(lines[thirdRefereeIndex + 1]),
    teamAway: compact(lines[squadsIndex + 3]),
    competition: mapCompetition(competitionValue),
    matchNumber: compact(matchNumberValue),
    scoreHome: score[1],
    scoreAway: score[2],
    targetRefereeName: compact(targetMatch[1])
  };

  if (!header.reportDate || !header.matchNumber || !header.firstRefereeName || !header.secondRefereeName) {
    throw new FederationPdfParseError('Dati gara obbligatori mancanti nell’intestazione PDF.');
  }

  const targetKey = federationNameKey(header.targetRefereeName);
  const firstKey = federationNameKey(header.firstRefereeName);
  const secondKey = federationNameKey(header.secondRefereeName);
  if (targetKey && targetKey === firstKey && targetKey !== secondKey) header.role = 'first';
  else if (targetKey && targetKey === secondKey && targetKey !== firstKey) header.role = 'second';
  else {
    throw new FederationPdfParseError(
      'Il campo ARBITRO del PDF non coincide in modo univoco con il 1° o il 2° arbitro.',
      'unresolved_referee_role'
    );
  }

  header.sportSeason = deriveSeason(header.reportDate);
  if (!header.sportSeason) throw new FederationPdfParseError('Data gara non valida nel PDF.');
  return header;
}

function parseStructuredEvaluation(lines) {
  const empty = createEmptyReport();
  const evaluation = empty.evaluations.first;
  const matchCharacteristics = empty.matchCharacteristics;

  matchCharacteristics.ratings.difficulty = ratingAfter(
    lines,
    /^1\s+CARATTERISTICHE/i,
    COMMON_MATCH_CHARACTERISTICS.groups[0].options
  );
  matchCharacteristics.comment = noteBetween(lines, /^1\s+CARATTERISTICHE/i, /^2\s+STATO/i);

  evaluation.sections.fitness.ratings.level = ratingAfter(
    lines,
    /^2\s+STATO/i,
    EVALUATION_SECTIONS[0].groups[0].options
  );
  evaluation.sections.fitness.comment = noteBetween(lines, /^2\s+STATO/i, /^3\s+CONDUZIONE/i);

  const management = evaluation.sections.management.ratings;
  management.leadership = ratingAfter(lines, /^3\.1\b/, EVALUATION_SECTIONS[1].groups[0].options);
  management.teamwork = ratingAfter(lines, /^3\.2\b/, EVALUATION_SECTIONS[1].groups[1].options);
  management.consistency = ratingAfter(lines, /^3\.3\b/, EVALUATION_SECTIONS[1].groups[2].options);
  evaluation.sections.management.comment = noteBetween(lines, /^3\s+CONDUZIONE/i, /^4\s+DISCIPLINA/i);

  const discipline = evaluation.sections.discipline.ratings;
  discipline.conflictManagement = ratingAfter(lines, /^4\.1\b/, EVALUATION_SECTIONS[2].groups[0].options);
  discipline.measures = ratingAfter(lines, /^4\.2\b/, EVALUATION_SECTIONS[2].groups[1].options);
  evaluation.sections.discipline.comment = noteBetween(lines, /^4\s+DISCIPLINA/i, /^5\s+TECNICA/i);

  const technique = evaluation.sections.technique.ratings;
  technique.travel = ratingAfter(lines, /^5\.1\.1\b/, EVALUATION_SECTIONS[3].groups[0].options);
  technique.timingRules = ratingAfter(lines, /^5\.1\.2\b/, EVALUATION_SECTIONS[3].groups[1].options);
  technique.otherViolations = ratingAfter(lines, /^5\.1\.3\b/, EVALUATION_SECTIONS[3].groups[2].options);
  technique.shootingFouls = ratingAfter(lines, /^5\.2\.1\b/, EVALUATION_SECTIONS[3].groups[3].options);
  technique.contactResponsibility = ratingAfter(lines, /^5\.2\.2\b/, EVALUATION_SECTIONS[3].groups[4].options);
  technique.rebound = ratingAfter(lines, /^5\.3\.1\b/, EVALUATION_SECTIONS[3].groups[5].options);
  technique.screensCuts = ratingAfter(lines, /^5\.3\.2\b/, EVALUATION_SECTIONS[3].groups[6].options);
  technique.unsportsmanlike = ratingAfter(lines, /^5\.4\b/, EVALUATION_SECTIONS[3].groups[7].options);
  technique.simulations = ratingAfter(lines, /^5\.5\b/, EVALUATION_SECTIONS[3].groups[8].options);
  evaluation.sections.technique.comment = noteBetween(lines, /^5\s+TECNICA/i, /^6\s+AMMINISTRAZIONE/i);

  evaluation.sections.administration.ratings.level = ratingAfter(
    lines,
    /^6\s+AMMINISTRAZIONE/i,
    EVALUATION_SECTIONS[4].groups[0].options
  );
  evaluation.sections.communication.ratings.level = ratingAfter(
    lines,
    /^7\s+COMUNICAZIONE/i,
    EVALUATION_SECTIONS[5].groups[0].options
  );
  evaluation.sections.mechanics.ratings.gameReading = ratingAfter(
    lines,
    /^8\.1\b/,
    EVALUATION_SECTIONS[6].groups[0].options
  );
  evaluation.sections.mechanics.ratings.responsibilities = ratingAfter(
    lines,
    /^8\.2\b/,
    EVALUATION_SECTIONS[6].groups[1].options
  );
  evaluation.sections.mechanics.comment = noteBetween(lines, /^8\s+MECCANICA/i, /^9\s+CONCLUSIONI/i);

  const conclusions = findLine(lines, /^9\s+CONCLUSIONI/i);
  const globalHint = findLine(lines, /Indicare eventuali punti di forza/i, conclusions + 1);
  const errorsHeading = findLine(lines, /^EVENTUALI ERRORI TECNICI/i, globalHint + 1);
  if (conclusions < 0 || globalHint < 0 || errorsHeading < 0) {
    throw new FederationPdfParseError('Sezione conclusioni non riconosciuta nel PDF.');
  }
  evaluation.globalJudgement = textBetween(lines, globalHint + 1, errorsHeading);

  const errorsHint = findLine(lines, /Indicare tipo di errore/i, errorsHeading + 1);
  const potentialHeading = findLine(lines, /^POTENZIALITA['’]?$/i, errorsHeading + 1);
  if (errorsHint < 0 || potentialHeading < 0) {
    throw new FederationPdfParseError('Sezioni errori tecnici o potenzialità non riconosciute nel PDF.');
  }
  evaluation.technicalErrors = textBetween(lines, errorsHint + 1, potentialHeading) || 'NO';

  const motivationHeading = findLine(lines, /^Motivazione$/i, potentialHeading + 1);
  const voteHeading = findLine(lines, /^VOTO$/i, potentialHeading + 1);
  const potentialValue = cleanLines(lines.slice(potentialHeading + 1, motivationHeading < 0 ? voteHeading : motivationHeading))
    .map((line) => POTENTIAL_LEVELS.find((value) => normalizeFederationText(value) === normalizeFederationText(line)))
    .find(Boolean) || '';
  evaluation.potential.level = potentialValue;
  evaluation.potential.comment = motivationHeading >= 0 && voteHeading > motivationHeading
    ? textBetween(lines, motivationHeading + 1, voteHeading)
    : '';

  const voteLine = voteHeading >= 0
    ? cleanLines(lines.slice(voteHeading + 1)).find((line) => /^\d{1,2}$/.test(line))
    : '';
  evaluation.vote = voteLine || '';

  return { evaluation, matchCharacteristics };
}

export function parseFederationReportText(text) {
  const cleanText = String(text || '');
  if (!cleanText.trim()) {
    throw new FederationPdfParseError('Il PDF non contiene testo selezionabile.', 'pdf_without_text');
  }
  const lines = cleanText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = parseStructuredHeader(lines, cleanText);
  const parsed = parseStructuredEvaluation(lines);
  return {
    parserVersion: 2,
    groupKey: `${header.sportSeason}|${header.matchNumber}`,
    role: header.role,
    header,
    ...parsed
  };
}

export async function parseFederationPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new FederationPdfParseError('File PDF vuoto o mancante.', 'empty_pdf');
  }
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new FederationPdfParseError('Il file caricato non è un PDF valido.', 'invalid_pdf_signature');
  }
  let data;
  try {
    data = await extractPdfText(buffer);
  } catch (_firstError) {
    try {
      data = await extractPdfText(buffer);
    } catch (_secondError) {
      throw new FederationPdfParseError('PDF non leggibile o protetto da password.', 'unreadable_pdf');
    }
  }
  return { ...parseFederationReportText(data.text || ''), pageCount: data.total || null };
}
