import { config } from '../config.js';
import { dbGet, dbRun } from '../database/db.js';
import { listSources, runFipSync } from './syncService.js';
import { sendOperationalEmail } from './emailService.js';

const JOB_NAME = 'fip_daily_sync';
let startTimer = null;
let pollTimer = null;

function zonedDateTime(now = new Date(), timezone = config.scheduledSync.timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`
  };
}

function parseSummary(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function publicJobStatus(row) {
  return {
    enabled: config.scheduledSync.enabled,
    time: config.scheduledSync.time,
    timezone: config.scheduledSync.timezone,
    alertsEnabled: Boolean(config.smtp && config.scheduledSync.alertEmail),
    lastRunDate: row?.last_run_key || null,
    status: row?.status || 'idle',
    startedAt: row?.started_at || null,
    finishedAt: row?.finished_at || null,
    summary: parseSummary(row?.summary_json)
  };
}

export async function getScheduledFipSyncStatus() {
  return publicJobStatus(await dbGet('SELECT * FROM scheduled_jobs WHERE job_name = ?', [JOB_NAME]));
}

async function claimRun(runDate) {
  const staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const result = await dbRun(
    `INSERT INTO scheduled_jobs (job_name, last_run_key, status, started_at, finished_at, summary_json, updated_at)
     VALUES (?, ?, 'running', iso_now(), NULL, NULL, iso_now())
     ON CONFLICT (job_name) DO UPDATE
       SET last_run_key = excluded.last_run_key,
           status = 'running',
           started_at = iso_now(),
           finished_at = NULL,
           summary_json = NULL,
           updated_at = iso_now()
     WHERE scheduled_jobs.last_run_key IS DISTINCT FROM excluded.last_run_key
        OR (scheduled_jobs.status = 'running' AND scheduled_jobs.started_at < ?)
     RETURNING job_name`,
    [JOB_NAME, runDate, staleBefore]
  );
  return result.rowCount > 0;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function runScheduledFipSync({
  now = new Date(),
  fetchImpl = fetch,
  force = false,
  sourceDelayMs = config.scheduledSync.sourceDelayMs
} = {}) {
  const local = zonedDateTime(now);
  if (!force && local.time < config.scheduledSync.time) {
    return { executed: false, reason: 'before-scheduled-time', runDate: local.date };
  }
  if (!(await claimRun(local.date))) {
    return { executed: false, reason: 'already-run', runDate: local.date };
  }

  const summary = { sources: [], totals: { sources: 0, success: 0, partial: 0, error: 0 } };
  let status = 'success';

  try {
    const sources = (await listSources()).filter((source) => source.active);
    summary.totals.sources = sources.length;

    for (const [index, source] of sources.entries()) {
      if (index > 0) await sleep(sourceDelayMs);
      try {
        const result = await runFipSync(source.id, { fetchImpl });
        summary.sources.push({
          sourceId: source.id,
          sourceName: source.name,
          status: result.status,
          created: result.created,
          updated: result.updated,
          officialsUpdated: result.officialsUpdated,
          conflicts: result.conflicts.length,
          errors: result.errors.length
        });
        summary.totals[result.status === 'partial' ? 'partial' : 'success'] += 1;
        if (result.status === 'partial') status = 'partial';
      } catch (error) {
        status = 'partial';
        summary.totals.error += 1;
        summary.sources.push({
          sourceId: source.id,
          sourceName: source.name,
          status: 'error',
          message: error.message
        });
      }
    }
  } catch (error) {
    status = 'error';
    summary.fatalError = error.message;
  }

  await dbRun(
    `UPDATE scheduled_jobs
        SET status = ?, finished_at = iso_now(), summary_json = ?, updated_at = iso_now()
      WHERE job_name = ?`,
    [status, JSON.stringify(summary), JOB_NAME]
  );

  if (status !== 'success' && config.scheduledSync.alertEmail) {
    try {
      const failures = summary.sources
        .filter((source) => source.status !== 'success')
        .map((source) => `- ${source.sourceName}: ${source.message || source.status}`)
        .join('\n');
      await sendOperationalEmail({
        to: config.scheduledSync.alertEmail,
        subject: `[FischioLab] Sync FIP automatico: ${status}`,
        text: [
          `Esito sincronizzazione automatica del ${local.date}: ${status}.`,
          '',
          failures || summary.fatalError || 'Controllare la pagina Sorgenti gare.'
        ].join('\n')
      });
    } catch (error) {
      console.error('Invio avviso sync FIP fallito:', error);
    }
  }

  if (status === 'error') {
    throw new Error(`Sincronizzazione FIP automatica fallita: ${summary.fatalError}`);
  }

  return { executed: true, runDate: local.date, status, summary };
}

async function tickScheduledSync() {
  try {
    const result = await runScheduledFipSync();
    if (result.executed) {
      console.log(
        `Sincronizzazione FIP automatica ${result.status}: ` +
          `${result.summary.totals.success} riuscite, ${result.summary.totals.partial} con avvisi, ${result.summary.totals.error} errori.`
      );
    }
  } catch (error) {
    console.error(error);
  }
}

export function startScheduledFipSync() {
  if (!config.scheduledSync.enabled || startTimer || pollTimer) return;
  console.log(
    `Sync FIP automatico attivo alle ${config.scheduledSync.time} (${config.scheduledSync.timezone}).`
  );
  startTimer = setTimeout(() => {
    startTimer = null;
    void tickScheduledSync();
  }, 10000);
  pollTimer = setInterval(() => void tickScheduledSync(), config.scheduledSync.pollMs);
  startTimer.unref?.();
  pollTimer.unref?.();
}

export function stopScheduledFipSync() {
  if (startTimer) clearTimeout(startTimer);
  if (pollTimer) clearInterval(pollTimer);
  startTimer = null;
  pollTimer = null;
}
