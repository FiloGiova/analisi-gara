import ExcelJS from 'exceljs';
import { listGames } from './gameService.js';
import { isGameInPeriod, formatPeriodLabel } from '../../shared/gamePeriod.js';

const STATE_LABELS = {
  calendario: 'Solo calendario',
  arbitri_mancanti: 'Arbitri da designare',
  senza_osservatore: 'Scoperta',
  designazione_completa: 'Designazione completa',
  rapporto_bozza: 'Rapporto in bozza',
  rapporto_definitivo: 'Rapporto definitivo',
  rinviata: 'Rinviata',
  annullata: 'Annullata'
};

function officialLabel(official) {
  if (!official) return '—';
  return official.refereeName || official.userName || official.externalName || '—';
}

function displayMatchNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

function formatDateTime(value) {
  const text = String(value || '');
  if (!text) return '—';
  const [year, month, day] = text.slice(0, 10).split('-');
  if (!year || !month || !day) return text;
  const time = text.length > 10 ? text.slice(11, 16) : '';
  return `${day}/${month}/${year}${time && time !== '00:00' ? ` · ${time}` : ''}`;
}

export function filterGamesForExport(games, {
  competition = '',
  matchday = '',
  sourceNames = [],
  refereeId = null,
  search = '',
  dateFrom = '',
  dateTo = ''
} = {}) {
  const cleanRefereeId = Number(refereeId) || null;
  const query = String(search || '').toLowerCase();
  return games.filter((game) => {
    if (!isGameInPeriod(game, dateFrom, dateTo)) return false;
    if (competition && game.competition !== competition) return false;
    if (matchday && String(game.matchday) !== String(matchday)) return false;
    if (sourceNames.length && !sourceNames.includes(game.sourceName)) return false;
    if (cleanRefereeId) {
      const hasReferee = ['referee1', 'referee2', 'referee3'].some(
        (role) => game.officials[role]?.refereeId === cleanRefereeId
      );
      if (!hasReferee) return false;
    }
    if (query) {
      const haystack = [
        game.matchNumber,
        game.teamHome,
        game.teamAway,
        officialLabel(game.officials.referee1),
        officialLabel(game.officials.referee2),
        officialLabel(game.officials.observer)
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export async function buildGamesWorkbook({
  season,
  competitions = [],
  competition = '',
  matchday = '',
  sourceNames = [],
  refereeId = null,
  search = '',
  dateFrom = '',
  dateTo = ''
}) {
  const allGames = await listGames({ season, competitions });
  const games = filterGamesForExport(
    allGames,
    { competition, matchday, sourceNames, refereeId, search, dateFrom, dateTo }
  );
  const cleanRefereeId = Number(refereeId) || null;
  const selectedReferee = cleanRefereeId
    ? allGames
        .flatMap((game) => ['referee1', 'referee2', 'referee3'].map((role) => game.officials[role]))
        .find((official) => official?.refereeId === cleanRefereeId)
    : null;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FischioLab';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Gare');
  const headers = [
    'N. gara',
    'Giornata',
    'Data',
    'Fase',
    'Incontro',
    '1° arbitro',
    '2° arbitro',
    'Osservatore',
    'Stato'
  ];
  const filterDescription = [
    `Stagione: ${season}`,
    `Campionato: ${competition || (competitions.length ? competitions.join(', ') : 'tutti')}`,
    `Fasi: ${sourceNames.length ? sourceNames.join(', ') : 'tutte'}`,
    `Giornata: ${matchday || 'tutte'}`,
    `Periodo: ${formatPeriodLabel(dateFrom, dateTo)}`,
    `Arbitro: ${selectedReferee ? officialLabel(selectedReferee) : cleanRefereeId ? `#${cleanRefereeId}` : 'tutti'}`,
    `Ricerca: ${String(search || '').trim() || 'nessuna'}`
  ].join(' · ');

  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow(headers);
  for (const game of games) {
    const score = game.scoreHome !== '' && game.scoreAway !== ''
      ? ` (${game.scoreHome}-${game.scoreAway})`
      : '';
    const state = `${STATE_LABELS[game.derivedState] || STATE_LABELS.calendario}${game.needsAlias ? ' · Nomi da associare' : ''}`;
    sheet.addRow([
      displayMatchNumber(game.matchNumber),
      game.matchday ?? '—',
      formatDateTime(game.scheduledAt),
      game.sourceName || '—',
      `${game.teamHome} - ${game.teamAway}${score}`,
      officialLabel(game.officials.referee1),
      officialLabel(game.officials.referee2),
      officialLabel(game.officials.observer),
      state
    ]);
  }

  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = 'FischioLab · Gare e designazioni';
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF123C69' } };
  sheet.mergeCells(2, 1, 2, headers.length);
  sheet.getCell(2, 1).value = filterDescription;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF5D6C75' } };

  const header = sheet.getRow(5);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C69' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;

  [12, 11, 19, 28, 42, 25, 25, 25, 25].forEach((width, index) => {
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
