import ExcelJS from 'exceljs';
import { currentSportSeason } from '../../shared/reportTemplate.js';
import { getRefereeRanking, listBandMembers, listReferees } from './refereeService.js';

const BAND_LABELS = {
  esordiente: 'Esordienti',
  playoff: 'Playoff',
  playout: 'Playout'
};

function formatDate(value) {
  const text = String(value || '');
  if (!text) return '';
  const [year, month, day] = text.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : text;
}

function activeForSeason(referee, season) {
  return season === currentSportSeason() ? referee.active : referee.seasonActive;
}

function bandsByReferee(members) {
  const result = new Map();
  for (const member of members) {
    if (!result.has(member.refereeId)) result.set(member.refereeId, new Set());
    result.get(member.refereeId).add(member.band);
  }
  return result;
}

export function filterRefereesForExport(referees, bandMap, {
  season,
  activeFilter = '',
  band = '',
  search = ''
}) {
  const query = String(search || '').toLowerCase();
  return referees.filter((referee) => {
    const nameMatch = !query
      || referee.firstName.toLowerCase().includes(query)
      || referee.lastName.toLowerCase().includes(query)
      || String(referee.province || '').toLowerCase().includes(query)
      || String(referee.licenseNumber || '').toLowerCase().includes(query);
    const activeMatch = activeFilter === ''
      || String(activeForSeason(referee, season) ? '1' : '0') === activeFilter;
    const bandMatch = !band || Boolean(bandMap.get(referee.id)?.has(band));
    return nameMatch && activeMatch && bandMatch;
  });
}

export async function buildRefereesWorkbook({
  season,
  competitions = [],
  activeFilter = '',
  band = '',
  search = ''
}) {
  const [allReferees, bandMembers] = await Promise.all([
    listReferees({ season, competitions }),
    listBandMembers({ season, competitions })
  ]);
  const bandMap = bandsByReferee(bandMembers);
  const referees = filterRefereesForExport(allReferees, bandMap, {
    season,
    activeFilter,
    band,
    search
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FischioLab';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Anagrafica arbitri');
  const headers = [
    'Tessera',
    'Cognome',
    'Nome',
    'Data di nascita',
    'Provincia',
    'Email',
    'Telefono',
    'Scadenza certificato',
    'Categoria',
    'Fascia',
    'Stato',
    'Note'
  ];
  const activeLabel = activeFilter === '1' ? 'attivi' : activeFilter === '0' ? 'inattivi' : 'tutti';
  const filterDescription = [
    `Stagione: ${season}`,
    `Campionato: ${competitions.length ? competitions.join(', ') : 'tutti'}`,
    `Fascia: ${BAND_LABELS[band] || 'tutte'}`,
    `Stato: ${activeLabel}`,
    `Ricerca: ${String(search || '').trim() || 'nessuna'}`
  ].join(' · ');

  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow(headers);
  for (const referee of referees) {
    const bands = [...(bandMap.get(referee.id) || [])]
      .map((value) => BAND_LABELS[value] || value)
      .sort((first, second) => first.localeCompare(second, 'it'));
    sheet.addRow([
      referee.licenseNumber || '',
      referee.lastName,
      referee.firstName,
      formatDate(referee.birthDate),
      referee.province || '',
      referee.email || '',
      referee.phone || '',
      formatDate(referee.certificateExpiry),
      referee.category || '',
      bands.join(', '),
      activeForSeason(referee, season) ? 'Attivo' : 'Inattivo',
      referee.notes || ''
    ]);
  }

  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = 'FischioLab · Anagrafica arbitri';
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF123C69' } };
  sheet.mergeCells(2, 1, 2, headers.length);
  sheet.getCell(2, 1).value = filterDescription;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF5D6C75' } };

  const header = sheet.getRow(5);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C69' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;

  [13, 22, 22, 18, 16, 32, 18, 21, 16, 18, 12, 42].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (let rowNumber = 6; rowNumber <= 5 + referees.length; rowNumber += 1) {
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

export async function buildRefereeRankingWorkbook({ season, competitions = [] }) {
  const ranking = await getRefereeRanking({ season, competitions });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FischioLab';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Classifica arbitri');
  const headers = ['Posizione', 'Cognome', 'Nome', 'Categoria', 'Voti', 'Valutazioni', 'Media'];

  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow(headers);
  ranking.forEach((referee, index) => {
    sheet.addRow([
      index + 1,
      referee.lastName,
      referee.firstName,
      referee.category || '',
      referee.votes.join(', '),
      referee.votesCount,
      referee.averageVote
    ]);
  });

  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = 'FischioLab · Classifica arbitri';
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF123C69' } };
  sheet.mergeCells(2, 1, 2, headers.length);
  sheet.getCell(2, 1).value = [
    `Stagione: ${season}`,
    `Campionato: ${competitions.length ? competitions.join(', ') : 'tutti'}`,
    'Ordinamento: media voto, numero valutazioni, cognome'
  ].join(' · ');
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF5D6C75' } };

  const header = sheet.getRow(5);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C69' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 28;

  [12, 24, 24, 18, 32, 14, 12].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getColumn(1).alignment = { horizontal: 'center' };
  sheet.getColumn(6).alignment = { horizontal: 'center' };
  sheet.getColumn(7).alignment = { horizontal: 'center' };
  sheet.getColumn(7).numFmt = '0.0';

  for (let rowNumber = 6; rowNumber <= 5 + ranking.length; rowNumber += 1) {
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
