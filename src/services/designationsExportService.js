import ExcelJS from 'exceljs';
import { listGames } from './gameService.js';
import { isGameInPeriod, formatPeriodLabel, periodFileSegment } from '../../shared/gamePeriod.js';

// Foglio delle designazioni osservatori da consegnare al designatore, che le
// ricopia nella piattaforma ufficiale. Esporta esattamente le gare filtrate
// nella pagina "Designa osservatori": stessi filtri, stesso ordine.

function officialLabel(official) {
  if (!official) return '';
  return official.refereeName || official.userName || official.externalName || '';
}

function displayMatchNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

function splitDateTime(value) {
  const text = String(value || '');
  if (!text) return { date: '—', time: '' };
  const [year, month, day] = text.slice(0, 10).split('-');
  if (!year || !month || !day) return { date: text, time: '' };
  const time = text.length > 10 ? text.slice(11, 16) : '';
  return { date: `${day}/${month}/${year}`, time: time && time !== '00:00' ? time : '' };
}

export function filterGamesForDesignations(games, {
  competition = '',
  sourceNames = [],
  matchdays = [],
  dateFrom = '',
  dateTo = '',
  onlyAssigned = false
} = {}) {
  const wantedMatchdays = matchdays.map((value) => String(value));
  return games.filter((game) => {
    if (game.status === 'cancelled') return false;
    if (competition && game.competition !== competition) return false;
    if (sourceNames.length && !sourceNames.includes(game.sourceName)) return false;
    if (wantedMatchdays.length && !wantedMatchdays.includes(String(game.matchday))) return false;
    if (!isGameInPeriod(game, dateFrom, dateTo)) return false;
    if (onlyAssigned && !game.officials.observer) return false;
    return true;
  });
}

export function designationsFileName({ season = '', competition = '', dateFrom = '', dateTo = '' } = {}) {
  const parts = ['designazioni'];
  if (competition) parts.push(competition.replace(/[^a-zA-Z0-9]+/g, '-'));
  const period = periodFileSegment(dateFrom, dateTo);
  if (period) parts.push(period);
  if (season) parts.push(season.replace('/', '-'));
  return `${parts.join('_')}.xlsx`;
}

export async function buildDesignationsWorkbook({
  season,
  competitions = [],
  competition = '',
  sourceNames = [],
  matchdays = [],
  dateFrom = '',
  dateTo = '',
  onlyAssigned = false
}) {
  const allGames = await listGames({ season, competitions });
  const games = filterGamesForDesignations(allGames, {
    competition,
    sourceNames,
    matchdays,
    dateFrom,
    dateTo,
    onlyAssigned
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FischioLab';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Designazioni');

  const headers = [
    'N. gara',
    'Data',
    'Ora',
    'Giorn.',
    'Campionato',
    'Squadra casa',
    'Squadra ospite',
    'Campo',
    '1° arbitro',
    '2° arbitro',
    'Osservatore',
    'Note'
  ];

  const filterDescription = [
    `Stagione: ${season}`,
    `Campionato: ${competition || (competitions.length ? competitions.join(', ') : 'tutti')}`,
    `Fasi: ${sourceNames.length ? sourceNames.join(', ') : 'tutte'}`,
    `Giornate: ${matchdays.length ? matchdays.join(', ') : 'tutte'}`,
    `Periodo: ${formatPeriodLabel(dateFrom, dateTo)}`,
    onlyAssigned ? 'Solo gare con osservatore' : 'Incluse le gare scoperte'
  ].join(' · ');

  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow(headers);

  for (const game of games) {
    const { date, time } = splitDateTime(game.scheduledAt);
    sheet.addRow([
      displayMatchNumber(game.matchNumber),
      date,
      time,
      game.matchday ?? '',
      game.competition || '',
      game.teamHome,
      game.teamAway,
      game.venue || '',
      officialLabel(game.officials.referee1),
      officialLabel(game.officials.referee2),
      officialLabel(game.officials.observer) || '—',
      ''
    ]);
  }

  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = 'FischioLab · Designazioni osservatori';
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF123C69' } };
  sheet.mergeCells(2, 1, 2, headers.length);
  sheet.getCell(2, 1).value = filterDescription;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF5D6C75' } };
  sheet.mergeCells(3, 1, 3, headers.length);
  sheet.getCell(3, 1).value = `${games.length} gare · ${games.filter((game) => game.officials.observer).length} con osservatore`;
  sheet.getCell(3, 1).font = { size: 10, color: { argb: 'FF5D6C75' } };

  const header = sheet.getRow(5);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C69' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;

  [12, 12, 8, 8, 16, 30, 30, 34, 24, 24, 26, 18].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  for (let rowNumber = 6; rowNumber <= 5 + games.length; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E2E8' } } };
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 5 }];
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return workbook;
}
