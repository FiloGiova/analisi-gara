import ExcelJS from 'exceljs';
import { HttpError } from '../utils/httpError.js';
import { getCoverage, getEmployment, getMatrix, listStatsPhases } from './statsService.js';

const VIEW_LABELS = {
  coverage: 'Copertura arbitri',
  matrix: 'Matrice incroci',
  employment: 'Impiego arbitri'
};

const BAND_LABELS = {
  esordiente: 'Esordienti',
  playoff: 'Playoff',
  playout: 'Playout'
};

function compareSortValues(first, second) {
  if (typeof first === 'number' && typeof second === 'number') return first - second;
  return String(first || '').localeCompare(String(second || ''), 'it', {
    sensitivity: 'base',
    numeric: true
  });
}

function sortRows(rows, { key, direction }, valueFor) {
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...rows].sort((first, second) => {
    const compared = compareSortValues(valueFor(first, key), valueFor(second, key));
    if (compared) return compared * multiplier;
    return String(first.fullName || first.label || '').localeCompare(
      String(second.fullName || second.label || ''),
      'it',
      { sensitivity: 'base' }
    );
  });
}

function matchesSearch(referee, search) {
  const query = String(search || '').trim().toLowerCase();
  if (!query) return true;
  return String(referee.fullName || '').toLowerCase().includes(query)
    || String(referee.license || '').toLowerCase().includes(query);
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [year, month, day] = String(isoDate).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(isoDate);
}

function roleLabel(role) {
  if (role === 'referee1') return '1°';
  if (role === 'referee2') return '2°';
  return '3°';
}

function coverageRows(data, search, sort) {
  const referees = data.referees.filter((referee) => matchesSearch(referee, search));
  return sortRows(referees, sort, (row, key) => {
    if (key.startsWith('matchday:')) {
      return row.timeline?.[key.replace('matchday:', '')]?.length || 0;
    }
    return {
      name: row.fullName,
      completed: row.completedCount || 0,
      last: row.lastCompletedDate ? new Date(row.lastCompletedDate).getTime() : 0
    }[key];
  });
}

function employmentRows(data, search, sort) {
  const referees = data.referees.filter((referee) => matchesSearch(referee, search));
  return sortRows(referees, sort, (row, key) => {
    if (key.startsWith('matchday:')) {
      return row.timeline?.[key.replace('matchday:', '')]?.length || 0;
    }
    return {
      name: row.fullName,
      games: row.totalGames || 0,
      last: row.lastDate ? new Date(row.lastDate).getTime() : 0
    }[key];
  });
}

function matrixRows(data, sort) {
  const cells = new Map(data.cells.map((cell) => [`${cell.observerKey}|${cell.refereeId}`, cell]));
  return {
    cells,
    observers: sortRows(data.observers, sort, (observer, key) => {
      if (key === 'observer') return observer.label;
      const refereeId = Number(String(key).replace('referee:', ''));
      const cell = cells.get(`${observer.key}|${refereeId}`);
      return (cell?.completed || 0) * 1000 + (cell?.scheduled || 0);
    })
  };
}

function decorateWorksheet(sheet, { title, filters, columnCount, headerRowNumber = 5 }) {
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell(1, 1).value = `FischioLab · ${title}`;
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF123C69' } };

  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell(2, 1).value = filters;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF5D6C75' } };

  const header = sheet.getRow(headerRowNumber);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C69' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;

  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber, xSplit: title === VIEW_LABELS.employment ? 1 : 0 }];
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: columnCount }
  };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.properties.defaultRowHeight = 20;
}

function styleDataRows(sheet, firstRow, lastRow, columnCount) {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: 'top', wrapText: true };
    for (let column = 1; column <= columnCount; column += 1) {
      row.getCell(column).border = {
        bottom: { style: 'hair', color: { argb: 'FFD9E2E8' } }
      };
    }
  }
}

function normalizedSort(view, sortKey, sortDirection) {
  const defaults = {
    coverage: 'name',
    employment: 'name',
    matrix: 'observer'
  };
  return {
    key: String(sortKey || defaults[view]),
    direction: sortDirection === 'desc' ? 'desc' : 'asc'
  };
}

export async function buildStatsWorkbook({
  view,
  season,
  competitions = [],
  band = '',
  phaseIds = [],
  search = '',
  sortKey = '',
  sortDirection = 'asc'
}) {
  if (!Object.hasOwn(VIEW_LABELS, view)) throw new HttpError(400, 'Vista statistiche non valida.');

  const [phaseOptions, data] = await Promise.all([
    listStatsPhases({ season, competitions }),
    view === 'coverage'
      ? getCoverage({ season, competitions, band, phaseIds })
      : view === 'employment'
        ? getEmployment({ season, competitions, band, phaseIds })
        : getMatrix({ season, competitions, band, phaseIds })
  ]);

  const selectedPhaseIds = new Set(phaseIds.map(Number));
  const selectedPhases = phaseOptions
    .filter((phase) => selectedPhaseIds.has(Number(phase.id)))
    .map((phase) => phase.name);
  const filterDescription = [
    `Stagione: ${season}`,
    `Campionato: ${competitions.length ? competitions.join(', ') : 'tutti'}`,
    `Fasi: ${selectedPhases.length ? selectedPhases.join(', ') : 'tutte'}`,
    `Fascia: ${BAND_LABELS[band] || 'tutte'}`,
    `Ricerca: ${String(search || '').trim() || 'nessuna'}`
  ].join(' · ');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FischioLab';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(VIEW_LABELS[view]);
  const sort = normalizedSort(view, sortKey, sortDirection);
  let headers;
  let rows;
  let widths;

  if (view === 'coverage') {
    headers = ['Arbitro', 'Completati', 'Ultimo', ...data.matchdays.map((matchday) => `G${matchday}`)];
    rows = coverageRows(data, search, sort).map((referee) => [
      referee.fullName,
      referee.completedCount || 0,
      referee.lastCompletedDate
        ? `${formatDate(referee.lastCompletedDate)}${referee.daysSinceLast !== null ? ` (${referee.daysSinceLast} gg)` : ''}`
        : '—',
      ...data.matchdays.map((matchday) => {
        const entries = referee.timeline?.[matchday] || [];
        return entries.length
          ? entries.map((entry) => `${entry.type === 'scheduled' ? '○' : '✓'} ${entry.observerLabel}`).join('\n')
          : '—';
      })
    ]);
    widths = [28, 13, 20, ...data.matchdays.map(() => 24)];
  } else if (view === 'employment') {
    headers = ['Arbitro', 'Gare', 'Ultima', ...data.matchdays.map((matchday) => `G${matchday}`)];
    rows = employmentRows(data, search, sort).map((referee) => [
      referee.fullName,
      referee.totalGames || 0,
      formatDate(referee.lastDate),
      ...data.matchdays.map((matchday) => {
        const entries = referee.timeline?.[matchday] || [];
        return entries.length
          ? entries.map((entry) => `${entry.teamHome || '—'} - ${entry.teamAway || '—'} (${roleLabel(entry.role)})`).join('\n')
          : '—';
      })
    ]);
    widths = [28, 10, 14, ...data.matchdays.map(() => 34)];
  } else {
    const referees = data.referees.filter((referee) => matchesSearch(referee, search));
    const { observers, cells } = matrixRows(data, sort);
    headers = ['Osservatore \\ Arbitro', ...referees.map((referee) => referee.fullName)];
    rows = observers.map((observer) => [
      `${observer.label}${observer.historical ? ' (storico)' : ''}`,
      ...referees.map((referee) => {
        const cell = cells.get(`${observer.key}|${referee.refereeId}`);
        const completed = cell?.completed || 0;
        const scheduled = cell?.scheduled || 0;
        return completed || scheduled ? `${completed}${scheduled ? ` (+${scheduled})` : ''}` : '·';
      })
    ]);
    widths = [30, ...referees.map(() => 22)];
  }

  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  decorateWorksheet(sheet, {
    title: VIEW_LABELS[view],
    filters: filterDescription,
    columnCount: headers.length
  });
  styleDataRows(sheet, 6, 5 + rows.length, headers.length);

  return workbook;
}
