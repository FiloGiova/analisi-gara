import { config } from '../config.js';
import { dbGet, dbRun } from '../database/db.js';
import { isFipAnalyticsConfigured, listSources, runSourceSync } from './syncService.js';
import { sendOperationalEmail } from './emailService.js';

// Due giri automatici indipendenti, ognuno con le proprie sorgenti:
// - sito FIP pubblico una volta al giorno (risultati e stato delle gare);
// - FIP Analytics negli orari configurati (calendario e designazioni), di
//   default alle 11:00 e alle 21:00.
// La chiave di esecuzione salvata in scheduled_jobs impedisce di ripetere lo
// stesso giro anche con più riavvii o più processi.
const JOBS = {
  fip: {
    name: 'fip_daily_sync',
    sourceType: 'fip_public',
    label: 'Sync FIP automatico',
    times: () => [config.scheduledSync.time],
    runKey: (date) => date,
    enabled: () => config.scheduledSync.enabled
  },
  analytics: {
    name: 'fip_analytics_sync',
    sourceType: 'fip_analytics',
    label: 'Sync FIP Analytics automatico',
    times: () => config.fipAnalytics.syncTimes,
    runKey: (date, slot) => `${date} ${slot}`,
    enabled: () => config.scheduledSync.enabled && isFipAnalyticsConfigured()
  }
};

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

function jobStatus(job, row) {
  const lastRunKey = row?.last_run_key || null;
  return {
    enabled: job.enabled(),
    time: job.times()[0],
    times: job.times(),
    timezone: config.scheduledSync.timezone,
    alertsEnabled: Boolean(config.smtp && config.scheduledSync.alertEmail),
    lastRunDate: lastRunKey ? lastRunKey.slice(0, 10) : null,
    lastRunKey,
    status: row?.status || 'idle',
    startedAt: row?.started_at || null,
    finishedAt: row?.finished_at || null,
    summary: parseSummary(row?.summary_json)
  };
}

async function getJobStatus(job) {
  return jobStatus(job, await dbGet('SELECT * FROM scheduled_jobs WHERE job_name = ?', [job.name]));
}

export function getScheduledFipSyncStatus() {
  return getJobStatus(JOBS.fip);
}

export async function getScheduledAnalyticsSyncStatus() {
  return { ...(await getJobStatus(JOBS.analytics)), configured: isFipAnalyticsConfigured() };
}

async function claimRun(jobName, runKey) {
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
    [jobName, runKey, staleBefore]
  );
  return result.rowCount > 0;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// L'ultimo orario già passato oggi: se il processo era spento alle 11:00 e
// riparte alle 15:00, il giro delle 11:00 viene recuperato subito.
function dueSlot(times, localTime) {
  return times.filter((time) => time <= localTime).pop() || null;
}

async function runScheduledJob(
  job,
  { now = new Date(), fetchImpl = fetch, force = false, sourceDelayMs = config.scheduledSync.sourceDelayMs, credentials = null } = {}
) {
  const local = zonedDateTime(now);
  const times = job.times();
  const slot = dueSlot(times, local.time);
  if (!force && !slot) {
    return { executed: false, reason: 'before-scheduled-time', runDate: local.date };
  }
  const runKey = job.runKey(local.date, slot || times[0]);
  if (!(await claimRun(job.name, runKey))) {
    return { executed: false, reason: 'already-run', runDate: local.date, runKey };
  }

  const summary = { sources: [], totals: { sources: 0, success: 0, partial: 0, error: 0 } };
  let status = 'success';

  try {
    const sources = (await listSources()).filter((source) => source.active && source.sourceType === job.sourceType);
    summary.totals.sources = sources.length;
    // Più gironi dello stesso campionato FIP Analytics: una sola richiesta.
    const cache = new Map();

    for (const [index, source] of sources.entries()) {
      if (index > 0) await sleep(sourceDelayMs);
      try {
        const result = await runSourceSync(source.id, { fetchImpl, cache, ...(credentials ? { credentials } : {}) });
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
    [status, JSON.stringify(summary), job.name]
  );

  if (status !== 'success' && config.scheduledSync.alertEmail) {
    try {
      const failures = summary.sources
        .filter((source) => source.status !== 'success')
        .map((source) => `- ${source.sourceName}: ${source.message || source.status}`)
        .join('\n');
      await sendOperationalEmail({
        to: config.scheduledSync.alertEmail,
        subject: `[FischioLab] ${job.label}: ${status}`,
        text: [
          `Esito sincronizzazione automatica (${runKey}): ${status}.`,
          '',
          failures || summary.fatalError || 'Controllare la pagina Sorgenti gare.'
        ].join('\n')
      });
    } catch (error) {
      console.error(`Invio avviso ${job.label} fallito:`, error);
    }
  }

  if (status === 'error') {
    throw new Error(`${job.label} fallito: ${summary.fatalError}`);
  }

  return { executed: true, runDate: local.date, runKey, status, summary };
}

export function runScheduledFipSync(options = {}) {
  return runScheduledJob(JOBS.fip, options);
}

export function runScheduledAnalyticsSync(options = {}) {
  return runScheduledJob(JOBS.analytics, options);
}

async function tickScheduledSync() {
  // In sequenza: i due giri non si sovrappongono sulle stesse gare.
  for (const job of Object.values(JOBS)) {
    if (!job.enabled()) continue;
    try {
      const result = await runScheduledJob(job);
      if (result.executed) {
        console.log(
          `${job.label} ${result.status} (${result.runKey}): ` +
            `${result.summary.totals.success} riuscite, ${result.summary.totals.partial} con avvisi, ${result.summary.totals.error} errori.`
        );
      }
    } catch (error) {
      console.error(error);
    }
  }
}

export function startScheduledFipSync() {
  if (!config.scheduledSync.enabled || startTimer || pollTimer) return;
  console.log(
    `Sync FIP automatico attivo alle ${config.scheduledSync.time} (${config.scheduledSync.timezone}).`
  );
  console.log(
    isFipAnalyticsConfigured()
      ? `Sync FIP Analytics automatico attivo alle ${config.fipAnalytics.syncTimes.join(' e ')}.`
      : 'Sync FIP Analytics automatico non attivo: credenziali FIP_ANALYTICS_* assenti.'
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
