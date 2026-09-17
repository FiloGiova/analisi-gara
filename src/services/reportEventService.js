import { dbAll, dbGet, dbRun } from '../database/db.js';

// Storico delle azioni sui rapporti: chi ha fatto cosa e quando. È un registro
// laterale, non una dipendenza del flusso: se la scrittura fallisce si perde la
// riga di log, non il salvataggio del rapporto dell'osservatore.

export const REPORT_EVENTS = {
  created: 'Rapporto creato',
  updated: 'Rapporto modificato',
  finalized: 'Reso definitivo',
  imported: 'Importato da PDF federale',
  attachment_added: 'Allegato caricato',
  attachment_removed: 'Allegato eliminato',
  exported: 'PDF generato',
  email_sent: 'Inviato via email',
  deleted: 'Rapporto cancellato'
};

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// I dati identificativi vengono copiati nella riga di log: dopo la
// cancellazione del rapporto non ci sarebbe più niente da cui ricavarli.
function snapshotOf(report = {}) {
  const data = report.data || report;
  const teams = [asText(data.teamHome), asText(data.teamAway)].filter(Boolean).join(' - ');
  const referees = [asText(data.firstRefereeName), asText(data.secondRefereeName)].filter(Boolean).join(', ');
  return {
    reportId: report.id || null,
    gameId: report.gameId || data.gameId || null,
    reportType: report.reportType === 'video' ? 'video' : 'full',
    status: asText(report.status || data.status),
    matchNumber: asText(report.matchNumber || data.matchNumber),
    competition: asText(report.competition || data.competition),
    sportSeason: asText(report.sportSeason || data.sportSeason),
    teams,
    referees,
    observerName: asText(report.observerName || data.observerName)
  };
}

export async function logReportEvent(event, report, user, { source = 'app', details = '' } = {}) {
  const snapshot = snapshotOf(report);
  try {
    await dbRun(
      `INSERT INTO report_events (
         report_id, game_id, event, report_type, status, match_number, competition, sport_season,
         teams, referees, observer_name, actor_user_id, actor_name, actor_role, source, details
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.reportId,
        snapshot.gameId,
        event,
        snapshot.reportType,
        snapshot.status,
        snapshot.matchNumber,
        snapshot.competition,
        snapshot.sportSeason,
        snapshot.teams,
        snapshot.referees,
        snapshot.observerName,
        user?.id || null,
        asText(user?.displayName || user?.username),
        asText(user?.role),
        source,
        asText(details)
      ]
    );
  } catch (error) {
    // Un registro che fa fallire l'azione registrata è peggio di un registro
    // incompleto: si annota l'anomalia e si prosegue.
    console.error('[report-events] impossibile registrare l’evento:', event, error.message);
  }
}

export async function listReportEvents({ limit = 100, offset = 0 } = {}) {
  const rows = await dbAll(
    `SELECT * FROM report_events ORDER BY id DESC LIMIT ? OFFSET ?`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0)]
  );
  const total = await dbGet('SELECT COUNT(*) AS count FROM report_events');
  return {
    events: rows.map((row) => ({
      id: row.id,
      reportId: row.report_id,
      gameId: row.game_id,
      event: row.event,
      eventLabel: REPORT_EVENTS[row.event] || row.event,
      reportType: row.report_type,
      status: row.status,
      matchNumber: row.match_number,
      competition: row.competition,
      sportSeason: row.sport_season,
      teams: row.teams,
      referees: row.referees,
      observerName: row.observer_name,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      source: row.source,
      details: row.details,
      createdAt: row.created_at
    })),
    total: Number(total?.count) || 0
  };
}
