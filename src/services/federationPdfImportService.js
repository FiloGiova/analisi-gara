import crypto from 'node:crypto';
import { createEmptyReport, deriveSeason } from '../../shared/reportTemplate.js';
import { dbAll, dbGet, dbRun, dbTx } from '../database/db.js';
import { HttpError } from '../utils/httpError.js';
import { cleanExternalName, normalizedNameKey } from '../utils/personNames.js';
import { instructorCompetitionsForSeason } from '../../shared/instructorAssignments.js';
import {
  resolveObserverName,
  resolveRefereeName
} from './nameMatching.js';
import {
  collectFinalValidationErrors,
  normalizeReportPayload
} from './reportService.js';
import {
  FederationPdfParseError,
  federationTextSimilarity,
  federationNameKey,
  normalizeFederationText,
  parseFederationPdfBuffer
} from './federationPdfParser.js';

const SOURCE = 'federation_pdf';
const HEADER_FIELDS = [
  'observerName',
  'reportDate',
  'matchNumber',
  'competition',
  'teamHome',
  'teamAway',
  'scoreHome',
  'scoreAway',
  'firstRefereeName',
  'secondRefereeName'
];

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function matchNumberKey(value) {
  const clean = asText(value);
  if (!/^\d+$/.test(clean)) return clean.toLowerCase();
  return clean.replace(/^0+(?=\d)/, '');
}

function assertImportAccess(user) {
  if (!user || !['admin', 'instructor'].includes(user.role)) {
    throw new HttpError(403, 'L’importazione PDF è riservata ad amministratori e formatori.');
  }
}

function assertCompetitionAccess(user, sportSeason, ...competitions) {
  if (user?.role !== 'instructor') return;
  const allowed = instructorCompetitionsForSeason(user, sportSeason);
  if (!allowed.length || competitions.filter(Boolean).some((competition) => !allowed.includes(competition))) {
    throw new HttpError(403, 'Il PDF o la gara appartengono a un campionato non assegnato alla tua utenza.');
  }
}

function fileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function comparableHeaderValue(field, value) {
  if (field === 'firstRefereeName' || field === 'secondRefereeName' || field === 'observerName') {
    return federationNameKey(value);
  }
  return normalizeFederationText(value);
}

function sharedDifferences(items) {
  if (items.length < 2) return [];
  const first = items[0];
  const differences = [];
  for (const field of HEADER_FIELDS) {
    const expected = comparableHeaderValue(field, first.parsed.header[field]);
    if (items.slice(1).some((item) => comparableHeaderValue(field, item.parsed.header[field]) !== expected)) {
      differences.push(field);
    }
  }
  const firstCharacteristics = first.parsed.matchCharacteristics;
  const characteristicsDiffer = items.slice(1).some((item) => (
    JSON.stringify(item.parsed.matchCharacteristics.ratings) !== JSON.stringify(firstCharacteristics.ratings) ||
    federationTextSimilarity(item.parsed.matchCharacteristics.comment, firstCharacteristics.comment) < 0.97
  ));
  if (characteristicsDiffer) {
    differences.push('matchCharacteristics');
  }
  return differences;
}

function gameMismatchWarnings(game, header) {
  if (!game) return [];
  const warnings = [];
  const compare = (label, current, incoming, normalize = normalizeFederationText) => {
    if (asText(current) && asText(incoming) && normalize(current) !== normalize(incoming)) {
      warnings.push({ field: label, gameValue: asText(current), pdfValue: asText(incoming) });
    }
  };
  compare('competition', game.competition, header.competition);
  compare('reportDate', asText(game.scheduled_at).slice(0, 10), header.reportDate, (value) => asText(value));
  compare('teamHome', game.team_home, header.teamHome);
  compare('teamAway', game.team_away, header.teamAway);
  compare('scoreHome', game.score_home, header.scoreHome, asText);
  compare('scoreAway', game.score_away, header.scoreAway, asText);
  return warnings;
}

function rowToGameCandidate(row) {
  return {
    id: row.id,
    sportSeason: row.sport_season,
    matchNumber: row.match_number,
    competition: row.competition || '',
    scheduledAt: row.scheduled_at || '',
    teamHome: row.team_home || '',
    teamAway: row.team_away || '',
    scoreHome: row.score_home ?? '',
    scoreAway: row.score_away ?? ''
  };
}

async function attachOfficials(games) {
  if (!games.length) return [];
  const rows = await dbAll(
    `SELECT go.game_id, go.role, go.referee_id, go.user_id, go.external_name, go.source, go.manual_lock,
            r.first_name AS referee_first_name, r.last_name AS referee_last_name,
            u.display_name AS user_display_name
       FROM game_officials go
       LEFT JOIN referees r ON r.id = go.referee_id
       LEFT JOIN users u ON u.id = go.user_id
      WHERE go.game_id IN (${games.map(() => '?').join(', ')})`,
    games.map((game) => game.id)
  );
  const byGame = new Map();
  for (const row of rows) {
    if (!byGame.has(row.game_id)) byGame.set(row.game_id, {});
    byGame.get(row.game_id)[row.role] = {
      refereeId: row.referee_id || null,
      userId: row.user_id || null,
      name: row.referee_id
        ? `${row.referee_last_name || ''} ${row.referee_first_name || ''}`.trim()
        : row.user_display_name || row.external_name || '',
      source: row.source,
      manualLock: Boolean(row.manual_lock)
    };
  }
  return games.map((game) => ({ ...game, officials: byGame.get(game.id) || {} }));
}

async function loadGameCandidates(header, user, contextGameId = null) {
  let rows;
  if (contextGameId) {
    rows = await dbAll('SELECT * FROM games WHERE id = ?', [contextGameId]);
  } else {
    const allowed = instructorCompetitionsForSeason(user, header.sportSeason);
    const clauses = ['sport_season = ?'];
    const params = [header.sportSeason];
    if (allowed.length) {
      clauses.push(`competition IN (${allowed.map(() => '?').join(', ')})`);
      params.push(...allowed);
    }
    rows = await dbAll(
      `SELECT * FROM games
        WHERE ${clauses.join(' AND ')}
        ORDER BY CASE WHEN regexp_replace(match_number, '^0+', '') = ? THEN 0 ELSE 1 END,
                 scheduled_at DESC NULLS LAST,
                 match_number
        LIMIT 1000`,
      [...params, matchNumberKey(header.matchNumber)]
    );
  }
  for (const row of rows) {
    assertCompetitionAccess(user, row.sport_season, row.competition);
  }
  return rows.map(rowToGameCandidate);
}

async function attachReportCandidates(games, header, user, contextReportId = null) {
  if (!games.length) return [];
  const ids = games.map((game) => game.id);
  const rows = await dbAll(
    `SELECT id, status, game_id, observer_name, updated_at, competition, match_number
       FROM reports
      WHERE game_id IN (${ids.map(() => '?').join(', ')})
         OR (game_id IS NULL AND sport_season = ?)
      ORDER BY CASE WHEN status = 'final' THEN 0 ELSE 1 END, updated_at DESC`,
    [...ids, header.sportSeason]
  );
  if (contextReportId && !rows.some((row) => row.id === contextReportId)) {
    const context = await dbGet(
      `SELECT id, status, game_id, observer_name, updated_at, competition, sport_season FROM reports WHERE id = ?`,
      [contextReportId]
    );
    if (!context) throw new HttpError(404, 'Rapporto di contesto non trovato.');
    assertCompetitionAccess(user, context.sport_season, context.competition);
    rows.unshift(context);
  }
  return games.map((game) => ({
    ...game,
    reportCandidates: rows
      .filter((row) => row.game_id === game.id ||
        (row.game_id === null && matchNumberKey(row.match_number) === matchNumberKey(header.matchNumber)))
      .map((row) => ({
        id: row.id,
        status: row.status,
        gameId: row.game_id || null,
        observerName: row.observer_name || '',
        updatedAt: row.updated_at || ''
      }))
  }));
}

function groupParsedFiles(parsedFiles) {
  const groups = new Map();
  for (const item of parsedFiles) {
    const key = item.parsed.groupKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

async function parseFiles(files) {
  const parsed = [];
  const fileErrors = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const hash = fileHash(file.buffer);
    try {
      const result = await parseFederationPdfBuffer(file.buffer);
      parsed.push({
        index,
        hash,
        originalName: file.originalname || `documento-${index + 1}.pdf`,
        parsed: result
      });
    } catch (error) {
      fileErrors.push({
        index,
        hash,
        originalName: file.originalname || `documento-${index + 1}.pdf`,
        code: error instanceof FederationPdfParseError ? error.code : 'parse_error',
        message: error.message || 'PDF non leggibile.'
      });
    }
  }
  return { parsed, fileErrors };
}

async function resolveHeaderPeople(header) {
  const [first, second, observer] = await Promise.all([
    resolveRefereeName(header.firstRefereeName, { source: SOURCE }),
    resolveRefereeName(header.secondRefereeName, { source: SOURCE }),
    resolveObserverName(header.observerName, { source: SOURCE })
  ]);
  return { first, second, observer };
}

async function contextGameIdFromReport(reportId, user) {
  if (!reportId) return null;
  const report = await dbGet('SELECT id, game_id, competition, sport_season FROM reports WHERE id = ?', [reportId]);
  if (!report) throw new HttpError(404, 'Rapporto di contesto non trovato.');
  assertCompetitionAccess(user, report.sport_season, report.competition);
  return report.game_id || null;
}

export async function previewFederationPdfImport({ files, contextGameId = null, contextReportId = null, user }) {
  assertImportAccess(user);
  const cleanGameId = asPositiveInteger(contextGameId) || await contextGameIdFromReport(asPositiveInteger(contextReportId), user);
  const cleanReportId = asPositiveInteger(contextReportId);
  const { parsed, fileErrors } = await parseFiles(files);
  const grouped = groupParsedFiles(parsed);
  const groups = [];

  for (const [groupKey, items] of grouped) {
    const roles = items.map((item) => item.parsed.role);
    const duplicateRoles = [...new Set(roles.filter((role, index) => roles.indexOf(role) !== index))];
    const differences = sharedDifferences(items);
    const representative = items.find((item) => item.parsed.role === 'first') || items[0];
    const header = representative.parsed.header;
    assertCompetitionAccess(user, header.sportSeason, header.competition);

    const peopleBySource = {};
    for (const item of items) {
      if (!peopleBySource[item.parsed.role]) {
        const resolved = await resolveHeaderPeople(item.parsed.header);
        peopleBySource[item.parsed.role] = {
          first: { externalName: item.parsed.header.firstRefereeName, ...resolved.first },
          second: { externalName: item.parsed.header.secondRefereeName, ...resolved.second },
          observer: { externalName: item.parsed.header.observerName, ...resolved.observer }
        };
      }
    }
    const representativePeople = peopleBySource[representative.parsed.role];
    const rawGameCandidates = await loadGameCandidates(header, user, cleanGameId);
    const gameCandidates = await attachReportCandidates(
      await attachOfficials(rawGameCandidates),
      header,
      user,
      cleanReportId
    );
    const exactGame = gameCandidates.find((game) =>
      game.sportSeason === header.sportSeason && matchNumberKey(game.matchNumber) === matchNumberKey(header.matchNumber)
    ) || null;
    const contextualGame = cleanGameId ? gameCandidates.find((game) => game.id === cleanGameId) || null : null;
    const proposedGame = contextualGame || exactGame;
    const mismatchWarnings = gameMismatchWarnings(proposedGame, header);
    const automaticGameId = contextualGame?.id || (exactGame && mismatchWarnings.length === 0 ? exactGame.id : null);
    const reportCandidates = gameCandidates.find((game) => game.id === automaticGameId)?.reportCandidates || [];
    const automaticReportId = cleanReportId || (reportCandidates.length === 1 ? reportCandidates[0].id : null);

    groups.push({
      groupKey,
      sportSeason: header.sportSeason,
      matchNumber: header.matchNumber,
      header,
      files: items.map((item) => ({
        index: item.index,
        hash: item.hash,
        originalName: item.originalName,
        role: item.parsed.role,
        targetRefereeName: item.parsed.header.targetRefereeName,
        vote: item.parsed.evaluation.vote,
        potential: item.parsed.evaluation.potential.level
      })),
      presentRoles: [...new Set(roles)],
      duplicateRoles,
      sharedDifferences: differences,
      people: {
        first: representativePeople.first,
        second: representativePeople.second,
        observer: representativePeople.observer
      },
      peopleBySource,
      gameCandidates,
      automaticGameId,
      proposedGameId: proposedGame?.id || null,
      gameWarnings: mismatchWarnings,
      reportCandidates,
      automaticReportId,
      requiresSharedSource: differences.length > 0,
      ready: duplicateRoles.length === 0 && Boolean(automaticGameId) &&
        Boolean(representativePeople.first.refereeId) && Boolean(representativePeople.second.refereeId) &&
        !differences.length && reportCandidates.length <= 1
    });
  }

  return {
    limits: { maxFiles: 20, maxFileSize: 4 * 1024 * 1024 },
    groups,
    fileErrors,
    summary: {
      files: files.length,
      parsed: parsed.length,
      errors: fileErrors.length,
      groups: groups.length,
      ready: groups.filter((group) => group.ready).length
    }
  };
}

function payloadFromReportRow(row) {
  let raw = {};
  try {
    raw = JSON.parse(row.payload_json || '{}');
  } catch (_error) {
    raw = {};
  }
  const payload = normalizeReportPayload(raw);
  return {
    ...payload,
    gameId: row.game_id || payload.gameId || null,
    firstRefereeId: row.first_referee_id || payload.firstRefereeId || null,
    secondRefereeId: row.second_referee_id || payload.secondRefereeId || null,
    evaluations: {
      first: { ...payload.evaluations.first, vote: row.first_referee_vote || payload.evaluations.first.vote || '' },
      second: { ...payload.evaluations.second, vote: row.second_referee_vote || payload.evaluations.second.vote || '' }
    }
  };
}

async function txSaveRefereeAlias(client, externalName, refereeId, userId) {
  const key = normalizedNameKey(externalName);
  await client.run(
    `INSERT INTO person_aliases (source, external_name, normalized_name, referee_id, user_id, verified_by, verified_at)
     VALUES (?, ?, ?, ?, NULL, ?, iso_now())
     ON CONFLICT (source, normalized_name) DO UPDATE SET
       external_name = excluded.external_name,
       referee_id = excluded.referee_id,
       user_id = NULL,
       verified_by = excluded.verified_by,
       verified_at = excluded.verified_at`,
    [SOURCE, cleanExternalName(externalName), key, refereeId, userId]
  );
}

async function txSaveObserverAlias(client, externalName, observerUserId, userId) {
  const key = normalizedNameKey(externalName);
  await client.run(
    `INSERT INTO person_aliases (source, external_name, normalized_name, referee_id, user_id, verified_by, verified_at)
     VALUES (?, ?, ?, NULL, ?, ?, iso_now())
     ON CONFLICT (source, normalized_name) DO UPDATE SET
       external_name = excluded.external_name,
       referee_id = NULL,
       user_id = excluded.user_id,
       verified_by = excluded.verified_by,
       verified_at = excluded.verified_at`,
    [SOURCE, cleanExternalName(externalName), key, observerUserId, userId]
  );
}

async function officialLabelTx(client, row) {
  if (!row) return '';
  if (row.referee_id) {
    const referee = await client.get('SELECT first_name, last_name FROM referees WHERE id = ?', [row.referee_id]);
    if (referee) return `${referee.last_name} ${referee.first_name}`.trim();
  }
  if (row.user_id) {
    const observer = await client.get('SELECT display_name FROM users WHERE id = ?', [row.user_id]);
    if (observer) return observer.display_name;
  }
  return row.external_name || '';
}

async function txSetOfficial(client, { gameId, role, refereeId = null, observerUserId = null, externalName, userId, syncRunId }) {
  const existing = await client.get('SELECT * FROM game_officials WHERE game_id = ? AND role = ?', [gameId, role]);
  const oldLabel = await officialLabelTx(client, existing);
  await client.run(
    `INSERT INTO game_officials (game_id, role, referee_id, user_id, external_name, source, status, manual_lock)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 1)
     ON CONFLICT (game_id, role) DO UPDATE SET
       referee_id = excluded.referee_id,
       user_id = excluded.user_id,
       external_name = excluded.external_name,
       source = excluded.source,
       status = excluded.status,
       manual_lock = excluded.manual_lock,
       updated_at = iso_now()`,
    [gameId, role, refereeId, observerUserId, cleanExternalName(externalName), SOURCE]
  );
  const updated = await client.get('SELECT * FROM game_officials WHERE game_id = ? AND role = ?', [gameId, role]);
  const newLabel = await officialLabelTx(client, updated);
  if (oldLabel !== newLabel) {
    await client.run(
      `INSERT INTO game_changes (game_id, field, old_value, new_value, source, changed_by, sync_run_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [gameId, `ufficiale:${role}`, oldLabel || null, newLabel || null, SOURCE, userId, syncRunId, 'Importazione rapporto PDF federale']
    );
  }
  await client.run('UPDATE games SET updated_at = iso_now() WHERE id = ?', [gameId]);
}

function selectedSharedItem(items, requestedRole) {
  if (items.length === 1) return items[0];
  const differences = sharedDifferences(items);
  if (!differences.length) return items.find((item) => item.parsed.role === 'first') || items[0];
  if (!['first', 'second'].includes(requestedRole)) {
    throw new HttpError(422, 'Scegli quale PDF usare per i dati comuni discordanti.');
  }
  const selected = items.find((item) => item.parsed.role === requestedRole);
  if (!selected) throw new HttpError(422, 'Il PDF scelto per i dati comuni non è presente.');
  return selected;
}

async function applyOneGroup({ items, decision, user, syncRunId, contextGameId = null, contextReportId = null }) {
  const hashes = items.map((item) => item.hash).sort();
  const expectedHashes = Array.isArray(decision.fileHashes) ? [...decision.fileHashes].sort() : [];
  if (JSON.stringify(hashes) !== JSON.stringify(expectedHashes)) {
    throw new HttpError(409, 'I PDF confermati non coincidono con quelli mostrati nell’anteprima.');
  }
  const duplicateRole = items.some((item, index) => items.findIndex((other) => other.parsed.role === item.parsed.role) !== index);
  if (duplicateRole) throw new HttpError(422, 'Sono presenti due PDF per lo stesso arbitro.');

  const shared = selectedSharedItem(items, decision.sharedSourceRole);
  const header = shared.parsed.header;
  const gameId = asPositiveInteger(decision.gameId);
  const reportId = asPositiveInteger(decision.reportId);
  const firstRefereeId = asPositiveInteger(decision.firstRefereeId);
  const secondRefereeId = asPositiveInteger(decision.secondRefereeId);
  const observerUserId = asPositiveInteger(decision.observerUserId);
  if (!gameId) throw new HttpError(422, 'Seleziona la gara da collegare.');
  if (contextGameId && gameId !== contextGameId) {
    throw new HttpError(409, 'La gara confermata non coincide con la pagina da cui hai avviato l’importazione.');
  }
  if (contextReportId && reportId !== contextReportId) {
    throw new HttpError(409, 'Il rapporto confermato non coincide con la pagina da cui hai avviato l’importazione.');
  }
  if (!firstRefereeId || !secondRefereeId) throw new HttpError(422, 'Associa entrambi gli arbitri all’anagrafica.');

  return dbTx(async (client) => {
    const game = await client.get('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) throw new HttpError(404, 'Gara selezionata non trovata.');
    assertCompetitionAccess(user, game.sport_season, header.competition, game.competition);

    const firstReferee = await client.get('SELECT id, first_name, last_name FROM referees WHERE id = ?', [firstRefereeId]);
    const secondReferee = await client.get('SELECT id, first_name, last_name FROM referees WHERE id = ?', [secondRefereeId]);
    if (!firstReferee || !secondReferee) throw new HttpError(404, 'Uno degli arbitri selezionati non esiste più.');
    if (user.role === 'instructor') {
      const scopedRows = await client.all(
        `SELECT referee_id FROM referee_season_categories
          WHERE sport_season = ? AND category = ? AND referee_id IN (?, ?)`,
        [game.sport_season, header.competition, firstRefereeId, secondRefereeId]
      );
      const scopedIds = new Set(scopedRows.map((row) => row.referee_id));
      if (!scopedIds.has(firstRefereeId) || !scopedIds.has(secondRefereeId)) {
        throw new HttpError(403, 'Uno degli arbitri selezionati è fuori dal campionato assegnato.');
      }
    }
    let observer = null;
    if (observerUserId) {
      observer = await client.get(`SELECT id, display_name, role FROM users WHERE id = ? AND role != 'referee'`, [observerUserId]);
      if (!observer) throw new HttpError(404, 'Osservatore selezionato non trovato.');
    }

    let reportRow = null;
    if (reportId) {
      if (decision.replaceExisting !== true) {
        throw new HttpError(409, 'Conferma esplicitamente la sostituzione del rapporto esistente.');
      }
      reportRow = await client.get('SELECT * FROM reports WHERE id = ?', [reportId]);
      if (!reportRow) throw new HttpError(404, 'Rapporto selezionato non trovato.');
      const compatible = reportRow.game_id === gameId ||
        (!reportRow.game_id && reportRow.sport_season === header.sportSeason &&
          matchNumberKey(reportRow.match_number) === matchNumberKey(header.matchNumber));
      if (!compatible) throw new HttpError(409, 'Il rapporto selezionato non appartiene alla gara scelta.');
    } else {
      const candidates = await client.all(
        `SELECT id FROM reports
          WHERE game_id = ?
             OR (game_id IS NULL AND sport_season = ? AND regexp_replace(match_number, '^0+', '') = ?)`,
        [gameId, header.sportSeason, matchNumberKey(header.matchNumber)]
      );
      if (candidates.length > 1) throw new HttpError(409, 'Esistono più rapporti candidati: seleziona quello da aggiornare.');
      if (candidates.length === 1) {
        throw new HttpError(409, 'Esiste già un rapporto: conferma esplicitamente la sostituzione.');
      }
    }

    const base = reportRow ? payloadFromReportRow(reportRow) : createEmptyReport();
    const importedRoles = items.map((item) => item.parsed.role);
    const firstName = `${firstReferee.last_name} ${firstReferee.first_name}`.trim();
    const secondName = `${secondReferee.last_name} ${secondReferee.first_name}`.trim();
    const payload = normalizeReportPayload({
      ...base,
      gameId,
      observerUserId: observerUserId || null,
      observerName: header.observerName,
      reportDate: header.reportDate,
      matchNumber: header.matchNumber,
      competition: header.competition,
      teamHome: header.teamHome,
      teamAway: header.teamAway,
      scoreHome: header.scoreHome,
      scoreAway: header.scoreAway,
      firstRefereeId,
      firstRefereeName: firstName,
      secondRefereeId,
      secondRefereeName: secondName,
      matchCharacteristics: shared.parsed.matchCharacteristics,
      evaluations: {
        first: items.find((item) => item.parsed.role === 'first')?.parsed.evaluation || base.evaluations.first,
        second: items.find((item) => item.parsed.role === 'second')?.parsed.evaluation || base.evaluations.second
      }
    });
    const validationErrors = collectFinalValidationErrors(payload);
    const status = validationErrors.length ? 'draft' : 'final';

    await txSaveRefereeAlias(client, header.firstRefereeName, firstRefereeId, user.id);
    await txSaveRefereeAlias(client, header.secondRefereeName, secondRefereeId, user.id);
    if (observer) await txSaveObserverAlias(client, header.observerName, observer.id, user.id);

    await txSetOfficial(client, {
      gameId,
      role: 'referee1',
      refereeId: firstRefereeId,
      externalName: header.firstRefereeName,
      userId: user.id,
      syncRunId
    });
    await txSetOfficial(client, {
      gameId,
      role: 'referee2',
      refereeId: secondRefereeId,
      externalName: header.secondRefereeName,
      userId: user.id,
      syncRunId
    });
    if (observer) {
      await txSetOfficial(client, {
        gameId,
        role: 'observer',
        observerUserId: observer.id,
        externalName: header.observerName,
        userId: user.id,
        syncRunId
      });
    }

    let savedReportId;
    if (reportRow) {
      await client.run(
        `UPDATE reports SET
           status = ?, observer_name = ?, report_date = ?, match_number = ?, competition = ?,
           team_home = ?, team_away = ?, score_home = ?, score_away = ?,
           first_referee_id = ?, first_referee_name = ?, second_referee_id = ?, second_referee_name = ?,
           first_referee_vote = ?, second_referee_vote = ?, payload_json = ?, sport_season = ?,
           game_id = ?, observer_id = ?, updated_at = ts_now(),
           finalized_at = CASE
             WHEN ? = 'final' AND finalized_at IS NULL THEN ts_now()
             WHEN ? = 'draft' THEN NULL
             ELSE finalized_at
           END,
           first_referee_sent_at = CASE WHEN ? = 1 THEN NULL ELSE first_referee_sent_at END,
           second_referee_sent_at = CASE WHEN ? = 1 THEN NULL ELSE second_referee_sent_at END
         WHERE id = ?`,
        [
          status, payload.observerName, payload.reportDate, payload.matchNumber, payload.competition,
          payload.teamHome, payload.teamAway, payload.scoreHome, payload.scoreAway,
          payload.firstRefereeId, payload.firstRefereeName, payload.secondRefereeId, payload.secondRefereeName,
          payload.evaluations.first.vote, payload.evaluations.second.vote,
          JSON.stringify({ ...payload, status }), header.sportSeason,
          gameId, observer?.id || null, status, status,
          importedRoles.includes('first') ? 1 : 0,
          importedRoles.includes('second') ? 1 : 0,
          reportRow.id
        ]
      );
      savedReportId = reportRow.id;
    } else {
      const inserted = await client.run(
        `INSERT INTO reports (
           status, observer_name, report_date, match_number, competition,
           team_home, team_away, score_home, score_away,
           first_referee_id, first_referee_name, second_referee_id, second_referee_name,
           first_referee_vote, second_referee_vote, payload_json, created_by, sport_season,
           game_id, observer_id, finalized_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN ? = 'final' THEN ts_now() ELSE NULL END)
         RETURNING id`,
        [
          status, payload.observerName, payload.reportDate, payload.matchNumber, payload.competition,
          payload.teamHome, payload.teamAway, payload.scoreHome, payload.scoreAway,
          payload.firstRefereeId, payload.firstRefereeName, payload.secondRefereeId, payload.secondRefereeName,
          payload.evaluations.first.vote, payload.evaluations.second.vote,
          JSON.stringify({ ...payload, status }), user.id, header.sportSeason,
          gameId, observer?.id || null, status
        ]
      );
      savedReportId = inserted.rows[0].id;
    }

    return {
      groupKey: shared.parsed.groupKey,
      reportId: savedReportId,
      gameId,
      status,
      action: reportRow ? 'updated' : 'created',
      importedRoles,
      validationErrors
    };
  });
}

export async function applyFederationPdfImport({ files, decisions, contextGameId = null, contextReportId = null, user }) {
  assertImportAccess(user);
  if (!Array.isArray(decisions) || !decisions.length) throw new HttpError(400, 'Nessun gruppo selezionato per l’importazione.');
  const { parsed, fileErrors } = await parseFiles(files);
  const grouped = groupParsedFiles(parsed);
  const cleanContextReportId = asPositiveInteger(contextReportId);
  const cleanContextGameId = asPositiveInteger(contextGameId) ||
    await contextGameIdFromReport(cleanContextReportId, user);
  const run = await dbRun(
    `INSERT INTO sync_runs (type, started_by) VALUES ('pdf_report_import', ?) RETURNING id`,
    [user.id]
  );
  const syncRunId = run.rows[0].id;
  const results = [];
  const errors = [...fileErrors];
  const conflicts = [];

  for (const decision of decisions) {
    const items = grouped.get(asText(decision.groupKey));
    if (!items) {
      errors.push({ groupKey: decision.groupKey, message: 'Gruppo PDF non trovato nel caricamento confermato.' });
      continue;
    }
    try {
      results.push(await applyOneGroup({
        items,
        decision,
        user,
        syncRunId,
        contextGameId: cleanContextGameId,
        contextReportId: cleanContextReportId
      }));
    } catch (error) {
      const item = { groupKey: decision.groupKey, message: error.message || 'Importazione non riuscita.' };
      if (error.statusCode === 409 || error.statusCode === 422) conflicts.push(item);
      else errors.push(item);
    }
  }

  const created = results.filter((item) => item.action === 'created').length;
  const updated = results.filter((item) => item.action === 'updated').length;
  const issues = errors.length + conflicts.length;
  const status = issues ? (results.length ? 'partial' : 'error') : 'success';
  const summary = { results, conflicts, errors };
  await dbRun(
    `UPDATE sync_runs SET
       finished_at = iso_now(), status = ?, created_count = ?, updated_count = ?,
       conflict_count = ?, error_count = ?, summary_json = ?
     WHERE id = ?`,
    [status, created, updated, conflicts.length, errors.length, JSON.stringify(summary), syncRunId]
  );

  return { syncRunId, status, created, updated, results, conflicts, errors };
}
