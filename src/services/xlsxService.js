import ExcelJS from 'exceljs';
import { dbGet, dbRun } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { listGames, setOfficial, getOfficialRow } from './gameService.js';
import { resolveRefereeName, resolveObserverName, normalizedNameKey, cleanExternalName } from './nameMatching.js';

// Import/export designazioni via XLSX. Il numero gara è la chiave: il file del
// designatore aggiorna gare già presenti, mai ne crea di nuove.

const TEMPLATE_COLUMNS = [
  { header: 'Numero gara', key: 'matchNumber', width: 14 },
  { header: 'Data', key: 'date', width: 12 },
  { header: 'Ora', key: 'time', width: 8 },
  { header: 'Squadra casa', key: 'teamHome', width: 32 },
  { header: 'Squadra ospite', key: 'teamAway', width: 32 },
  { header: 'Campo', key: 'venue', width: 36 },
  { header: 'Arbitro 1', key: 'referee1', width: 24 },
  { header: 'Arbitro 2', key: 'referee2', width: 24 },
  { header: 'Arbitro 3', key: 'referee3', width: 24 },
  { header: 'Osservatore', key: 'observer', width: 24 }
];

// Intestazioni riconosciute in importazione (tolleranti su maiuscole/varianti).
const HEADER_ALIASES = {
  'numero gara': 'matchNumber',
  'n. gara': 'matchNumber',
  gara: 'matchNumber',
  'arbitro 1': 'referee1',
  '1 arbitro': 'referee1',
  'arbitro 2': 'referee2',
  '2 arbitro': 'referee2',
  'arbitro 3': 'referee3',
  '3 arbitro': 'referee3',
  osservatore: 'observer'
};

const OFFICIAL_ROLES = ['referee1', 'referee2', 'referee3', 'observer'];

function normalizeHeader(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[°º.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMatchNumber(value) {
  const clean = String(value ?? '').trim();
  if (!clean) return '';
  // Excel spesso converte "000311" nel numero 311: si ripristinano gli zeri.
  if (/^\d+$/.test(clean) && clean.length < 6) return clean.padStart(6, '0');
  return clean;
}

function officialName(official) {
  if (!official) return '';
  return official.refereeName || official.userName || official.externalName || '';
}

// ---------------------------------------------------------------------------
// Template scaricabile: un foglio per giornata, precompilato con le gare e le
// designazioni note. Rigenerarlo dopo una modifica produce il file aggiornato.
// ---------------------------------------------------------------------------
export async function buildDesignationsTemplate(sportSeason) {
  const games = await listGames({ season: sportSeason });
  if (!games.length) {
    throw new HttpError(404, `Nessuna gara nella stagione ${sportSeason}: sincronizza prima il calendario.`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rapporti Arbitrali';

  const info = workbook.addWorksheet('Istruzioni');
  info.columns = [{ width: 100 }];
  const instructions = [
    'DESIGNAZIONI ARBITRALI — ISTRUZIONI',
    '',
    `Stagione: ${sportSeason}. Un foglio per ogni giornata.`,
    'Compilare solo le colonne "Arbitro 1", "Arbitro 2", "Arbitro 3" e "Osservatore" (formato: Cognome Nome).',
    'Non modificare la colonna "Numero gara": è la chiave usata per aggiornare le gare.',
    'Le celle lasciate vuote vengono ignorate: non cancellano designazioni già presenti.',
    'Le altre colonne (data, squadre, campo) sono solo informative.'
  ];
  for (const line of instructions) {
    const row = info.addRow([line]);
    if (line === instructions[0]) row.font = { bold: true, size: 14 };
  }

  const byMatchday = new Map();
  for (const game of games) {
    const key = game.matchday ?? 'x';
    if (!byMatchday.has(key)) byMatchday.set(key, []);
    byMatchday.get(key).push(game);
  }
  const matchdays = [...byMatchday.keys()].sort((a, b) => {
    if (a === 'x') return 1;
    if (b === 'x') return -1;
    return a - b;
  });

  for (const matchday of matchdays) {
    const sheet = workbook.addWorksheet(matchday === 'x' ? 'Senza giornata' : `Giornata ${matchday}`);
    sheet.columns = TEMPLATE_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4ECF6' } };

    for (const game of byMatchday.get(matchday)) {
      const scheduled = game.scheduledAt || '';
      sheet.addRow({
        matchNumber: game.matchNumber,
        date: scheduled ? scheduled.slice(0, 10).split('-').reverse().join('/') : '',
        time: scheduled.length > 10 ? scheduled.slice(11, 16) : '',
        teamHome: game.teamHome,
        teamAway: game.teamAway,
        venue: game.venue,
        referee1: officialName(game.officials.referee1),
        referee2: officialName(game.officials.referee2),
        referee3: officialName(game.officials.referee3),
        observer: officialName(game.officials.observer)
      });
    }
  }

  return workbook;
}

// ---------------------------------------------------------------------------
// Parsing del file compilato: legge tutti i fogli (tranne "Istruzioni"),
// individua le intestazioni e restituisce righe grezze normalizzate.
// ---------------------------------------------------------------------------
export async function parseDesignationsWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (_) {
    throw new HttpError(400, 'File non leggibile: caricare un file .xlsx valido.');
  }

  const rows = [];
  workbook.eachSheet((sheet) => {
    if (normalizeHeader(sheet.name) === 'istruzioni') return;

    let headerRowNumber = 0;
    const columns = {};
    for (let r = 1; r <= Math.min(sheet.rowCount, 5) && !headerRowNumber; r += 1) {
      const row = sheet.getRow(r);
      row.eachCell((cell, col) => {
        const field = HEADER_ALIASES[normalizeHeader(cell.text)];
        if (field) columns[field] = col;
      });
      if (columns.matchNumber) headerRowNumber = r;
      else Object.keys(columns).forEach((k) => delete columns[k]);
    }
    if (!headerRowNumber) return;

    for (let r = headerRowNumber + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const matchNumber = normalizeMatchNumber(row.getCell(columns.matchNumber).text);
      if (!matchNumber) continue;
      const entry = { sheetName: sheet.name, rowNumber: r, matchNumber };
      for (const role of OFFICIAL_ROLES) {
        entry[role] = columns[role] ? cleanExternalName(row.getCell(columns[role]).text) : '';
      }
      rows.push(entry);
    }
  });

  if (!rows.length) {
    throw new HttpError(400, 'Nessuna riga valida trovata: il file deve contenere la colonna "Numero gara".');
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Valutazione riga per riga (usata sia dall'anteprima sia dall'applicazione).
// ---------------------------------------------------------------------------
async function evaluateRow(row, sportSeason) {
  const game = await dbGet('SELECT id, match_number FROM games WHERE sport_season = ? AND match_number = ?', [
    sportSeason,
    row.matchNumber
  ]);

  if (!game) {
    return { ...row, gameId: null, status: 'errore', message: `Gara ${row.matchNumber} non trovata nella stagione ${sportSeason}.`, items: [] };
  }

  const items = [];
  for (const role of OFFICIAL_ROLES) {
    const name = row[role];
    if (!name) continue; // cella vuota: mai cancellare designazioni esistenti

    const isObserver = role === 'observer';
    const resolution = isObserver
      ? await resolveObserverName(name, { source: 'xlsx' })
      : await resolveRefereeName(name, { source: 'xlsx' });
    const resolvedId = isObserver ? resolution.userId : resolution.refereeId;

    const current = await getOfficialRow(game.id, role);
    const currentId = current ? (isObserver ? current.user_id : current.referee_id) : null;
    const sameIdentity = current
      ? resolvedId
        ? currentId === resolvedId
        : normalizedNameKey(current.external_name || '') === normalizedNameKey(name)
      : false;

    let action;
    if (sameIdentity) action = 'invariato';
    else if (current?.manual_lock) action = 'conflitto';
    else if (current?.source === 'manual') action = 'conflitto';
    else if (current) action = 'aggiornato';
    else action = 'nuovo';

    items.push({
      role,
      name,
      resolvedId,
      via: resolution.via,
      candidates: resolution.candidates || [],
      currentName: current ? current.external_name || '' : '',
      currentSource: current?.source || null,
      locked: Boolean(current?.manual_lock),
      action
    });
  }

  const status = items.some((item) => item.action === 'conflitto') ? 'conflitti' : 'ok';
  return { ...row, gameId: game.id, status, message: '', items };
}

export async function previewDesignationsImport({ sportSeason, rows }) {
  const evaluated = [];
  for (const row of rows) {
    evaluated.push(await evaluateRow(row, sportSeason));
  }
  const summary = {
    totalRows: evaluated.length,
    notFound: evaluated.filter((r) => r.status === 'errore').length,
    toCreate: 0,
    toUpdate: 0,
    unchanged: 0,
    unresolved: 0,
    conflicts: 0
  };
  for (const row of evaluated) {
    for (const item of row.items) {
      if (item.action === 'nuovo') summary.toCreate += 1;
      if (item.action === 'aggiornato') summary.toUpdate += 1;
      if (item.action === 'invariato') summary.unchanged += 1;
      if (item.action === 'conflitto') summary.conflicts += 1;
      if (!item.resolvedId && item.action !== 'invariato') summary.unresolved += 1;
    }
  }
  return { rows: evaluated, summary };
}

export async function applyDesignationsImport({ sportSeason, rows, user = null }) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new HttpError(400, 'Nessuna riga da importare.');
  }

  const runResult = await dbRun(
    `INSERT INTO sync_runs (type, started_by) VALUES ('xlsx_import', ?) RETURNING id`,
    [user?.id || null]
  );
  const syncRunId = runResult.rows[0].id;

  const summary = { conflicts: [], unresolved: [], errors: [] };
  const counters = { applied: 0, unchanged: 0 };

  // Applicazione sequenziale idempotente (come la sync FIP): setOfficial usa il
  // pool, quindi non c'è una singola transazione avvolgente. Rieseguire è sicuro.
  for (const raw of rows) {
    const row = await evaluateRow(
      {
        sheetName: raw.sheetName || '',
        rowNumber: raw.rowNumber || 0,
        matchNumber: normalizeMatchNumber(raw.matchNumber),
        referee1: cleanExternalName(raw.referee1 || ''),
        referee2: cleanExternalName(raw.referee2 || ''),
        referee3: cleanExternalName(raw.referee3 || ''),
        observer: cleanExternalName(raw.observer || '')
      },
      sportSeason
    );

    if (row.status === 'errore') {
      summary.errors.push({ matchNumber: row.matchNumber, message: row.message });
      continue;
    }

    for (const item of row.items) {
      if (item.action === 'invariato') {
        counters.unchanged += 1;
        continue;
      }
      if (item.action === 'conflitto') {
        summary.conflicts.push({
          matchNumber: row.matchNumber,
          field: `ufficiale:${item.role}`,
          currentValue: item.currentName,
          incomingValue: item.name,
          currentSource: item.locked ? `${item.currentSource} (bloccato)` : item.currentSource,
          incomingSource: 'xlsx',
          proposal: item.locked
            ? 'Valore bloccato manualmente: sbloccare dal dettaglio gara per accettare il file.'
            : 'Designazione inserita manualmente: confermare dal dettaglio gara.'
        });
        continue;
      }

      await setOfficial(
        row.gameId,
        {
          role: item.role,
          refereeId: item.role === 'observer' ? null : item.resolvedId,
          userId: item.role === 'observer' ? item.resolvedId : null,
          externalName: item.name,
          source: 'xlsx',
          status: 'confirmed'
        },
        { user, syncRunId }
      );
      counters.applied += 1;

      if (!item.resolvedId) {
        summary.unresolved.push({
          matchNumber: row.matchNumber,
          role: item.role,
          externalName: item.name,
          candidates: item.candidates
        });
      }
    }
  }

  const status = summary.errors.length || summary.conflicts.length ? 'partial' : 'success';
  await dbRun(
    `UPDATE sync_runs
        SET finished_at = iso_now(),
            status = ?, created_count = 0, updated_count = ?, conflict_count = ?, error_count = ?, summary_json = ?
      WHERE id = ?`,
    [status, counters.applied, summary.conflicts.length, summary.errors.length, JSON.stringify(summary), syncRunId]
  );

  return {
    syncRunId,
    status,
    applied: counters.applied,
    unchanged: counters.unchanged,
    conflicts: summary.conflicts,
    unresolved: summary.unresolved,
    errors: summary.errors
  };
}
