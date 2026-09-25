import { useEffect, useMemo, useState } from 'react';
import { useCompetitions } from '../lib/competitions.jsx';
import Select from '../components/Select.jsx';
import SegmentedChoice from '../components/SegmentedChoice.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatMatchNumber, formatDateTime } from '../lib/formatters.js';
import ListSkeleton from '../components/ListSkeleton.jsx';
import { can } from '../../../shared/permissions.js';

const SOURCE_TYPE_LABELS = {
  fip_analytics: 'FIP Analytics',
  fip_public: 'Sito FIP'
};
const SOURCE_TYPE_BY_LABEL = Object.fromEntries(Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => [label, value]));

const ROLE_LABELS = { referee1: '1° arbitro', referee2: '2° arbitro', referee3: '3° arbitro' };

function emptyForm(season) {
  return {
    sourceType: 'fip_analytics',
    name: '',
    sportSeason: season,
    competition: '',
    url: '',
    codCampionato: ''
  };
}

const SYNC_STATUS_LABELS = {
  success: 'Completata',
  partial: 'Completata con avvisi',
  error: 'Errore',
  running: 'In corso'
};

function timesLabel(times = []) {
  if (times.length <= 1) return `alle ${times[0] || '—'}`;
  return `alle ${times.slice(0, -1).join(', ')} e alle ${times[times.length - 1]}`;
}

// Un giro automatico: cosa fa, quando, com'è andato l'ultimo.
function ScheduledJob({ title, job, description, disabledReason }) {
  const lastRun = job.lastRunKey ? formatDateTime(job.lastRunKey.replace(' ', 'T')) : null;
  return (
    <div className="section-heading">
      <div>
        <h3>{title}</h3>
        <p>
          {job.enabled ? description : disabledReason}
          {job.enabled && job.alertsEnabled ? ' Gli errori vengono notificati via email.' : ''}
        </p>
        {lastRun ? (
          <p>
            Ultima esecuzione: {lastRun} · {SYNC_STATUS_LABELS[job.status] || job.status}
            {job.summary?.totals
              ? ` · ${job.summary.totals.success} riuscite, ${job.summary.totals.partial} con avvisi, ${job.summary.totals.error} errori`
              : ''}
          </p>
        ) : null}
      </div>
      <span className={`status-pill status-${job.enabled ? job.status : 'idle'}`}>
        {job.enabled ? (SYNC_STATUS_LABELS[job.status] || 'In attesa') : 'Disattivata'}
      </span>
    </div>
  );
}

export default function AdminSourcesPage({ currentUser, season }) {
  const { activeCompetitions } = useCompetitions();
  const [sources, setSources] = useState([]);
  const [scheduledSync, setScheduledSync] = useState(null);
  const [analyticsSync, setAnalyticsSync] = useState(null);
  const [campionati, setCampionati] = useState({ status: 'idle', list: [], error: '' });
  const [form, setForm] = useState(() => emptyForm(season));
  const [showForm, setShowForm] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [runsBySource, setRunsBySource] = useState({});
  const [expandedRuns, setExpandedRuns] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [renaming, setRenaming] = useState(null); // id della sorgente in rinomina
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isAdmin = can(currentUser, 'sources:manage');

  async function load() {
    setLoading(true);
    try {
      const data = await api.listSources({ season });
      setSources(data.sources || []);
      setScheduledSync(data.scheduledSync || null);
      setAnalyticsSync(data.analyticsSync || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare le sorgenti.');
    } finally {
      setLoading(false);
    }
  }

  function startRename(source) {
    setRenaming(source.id);
    setRenameValue(source.name);
    setError('');
    setSuccess('');
  }

  async function handleRename(source) {
    const name = renameValue.trim();
    if (!name || name === source.name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.updateSource(source.id, { name });
      setSuccess(`Sorgente rinominata in "${name}".`);
      setRenaming(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rinomina non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    setForm(emptyForm(season));
    setShowForm(false);
    setSyncResult(null);
    setExpandedRuns(null);
    load();
  }, [isAdmin, season]);

  const analyticsConfigured = Boolean(analyticsSync?.configured);
  const wantsCampionati = showForm && form.sourceType === 'fip_analytics' && analyticsConfigured;

  // I campionati FIP si leggono dall'account configurato solo quando servono.
  useEffect(() => {
    if (!wantsCampionati) return undefined;
    let cancelled = false;
    setCampionati({ status: 'loading', list: [], error: '' });
    api
      .listAnalyticsCampionati({ season })
      .then((data) => {
        if (!cancelled) setCampionati({ status: 'ready', list: data.campionati || [], error: '' });
      })
      .catch((err) => {
        if (!cancelled) {
          setCampionati({
            status: 'error',
            list: [],
            error: err instanceof ApiError ? err.message : 'Impossibile leggere i campionati da FIP Analytics.'
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [wantsCampionati, season]);

  // Campionati con una sorgente FIP Analytics attiva: sulle gare che ne
  // arrivano, il sito FIP aggiorna solo risultato e stato.
  const analyticsCovered = useMemo(
    () =>
      new Set(
        sources
          .filter((source) => source.sourceType === 'fip_analytics' && source.active && source.competition)
          .map((source) => `${source.sportSeason}|${source.competition}`)
      ),
    [sources]
  );

  if (!isAdmin) {
    return <div className="empty-state"><h2>Sezione riservata agli amministratori</h2></div>;
  }

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const payload = form.sourceType === 'fip_analytics'
        ? { sourceType: 'fip_analytics', sportSeason: form.sportSeason, name: form.name, competition: form.competition, codCampionato: form.codCampionato }
        : { sportSeason: form.sportSeason, name: form.name, competition: form.competition, url: form.url };
      const data = await api.createSource(payload);
      const created = data.sources || [];
      const names = created.map((s) => s.name).join(', ');
      const base = created.length > 1
        ? `Creati ${created.length} gironi (${names}). Ora sincronizzali uno alla volta.`
        : `Sorgente "${names}" creata. Ora puoi eseguire la prima sincronizzazione.`;
      const skippedMsg = data.skipped?.length ? ` Già configurati e saltati: ${data.skipped.join(', ')}.` : '';
      setSuccess(base + skippedMsg);
      setForm(emptyForm(season));
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Creazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSync(source) {
    if (syncingId) return;
    setSyncingId(source.id);
    setError('');
    setSuccess('');
    setSyncResult(null);
    try {
      const data = await api.syncSource(source.id);
      setSyncResult({ sourceName: source.name, ...data.result });
      await load();
      if (expandedRuns === source.id) await loadRuns(source.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sincronizzazione non riuscita.');
    } finally {
      setSyncingId(null);
    }
  }

  async function toggleActive(source) {
    setError('');
    try {
      await api.updateSource(source.id, { active: !source.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Operazione non riuscita.');
    }
  }

  async function loadRuns(sourceId) {
    try {
      const data = await api.listSourceRuns(sourceId);
      setRunsBySource((prev) => ({ ...prev, [sourceId]: data.runs || [] }));
    } catch {
      setRunsBySource((prev) => ({ ...prev, [sourceId]: [] }));
    }
  }

  async function toggleRuns(sourceId) {
    if (expandedRuns === sourceId) {
      setExpandedRuns(null);
      return;
    }
    setExpandedRuns(sourceId);
    await loadRuns(sourceId);
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteSource(deleting.id);
      setSuccess(`Sorgente "${deleting.name}" eliminata. Le gare già importate restano nel database.`);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eliminazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione · stagione {season}</p>
          <h1>Sorgenti gare e sincronizzazioni</h1>
          <p>
            FIP Analytics porta calendario e designazioni arbitrali appena il designatore le carica; il
            sito FIP porta risultati e stato delle gare. La sincronizzazione non tocca mai gli osservatori
            né i dati bloccati.
          </p>
        </div>
        {!showForm ? (
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }}>
              + Nuova sorgente
            </button>
          </div>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      {scheduledSync || analyticsSync ? (
        <section className="toolbar-card">
          <div className="section-heading">
            <div>
              <h2>Sincronizzazione automatica</h2>
              <p>Vengono elaborate in sequenza soltanto le sorgenti attive, ognuna nel proprio giro.</p>
            </div>
          </div>
          <div className="scheduled-jobs">
            {analyticsSync ? (
              <ScheduledJob
                title="FIP Analytics · calendario e designazioni"
                job={analyticsSync}
                description={`Ogni giorno ${timesLabel(analyticsSync.times)} (${analyticsSync.timezone}).`}
                disabledReason={
                  analyticsSync.configured
                    ? 'Disattivata nelle variabili d’ambiente (ENABLE_SCHEDULED_SYNC).'
                    : 'Credenziali assenti: impostare FIP_ANALYTICS_USERNAME e FIP_ANALYTICS_PASSWORD nelle variabili d’ambiente.'
                }
              />
            ) : null}
            {scheduledSync ? (
              <ScheduledJob
                title="Sito FIP · risultati e stato gare"
                job={{ ...scheduledSync, lastRunKey: scheduledSync.lastRunKey || scheduledSync.lastRunDate }}
                description={`Ogni giorno ${timesLabel([scheduledSync.time])} (${scheduledSync.timezone}).`}
                disabledReason="Disattivata nelle variabili d’ambiente (ENABLE_SCHEDULED_SYNC)."
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {syncResult ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Esito sincronizzazione — {syncResult.sourceName}</h2>
              <p>
                {syncResult.sourceType === 'fip_analytics'
                  ? `${syncResult.gamesRead} gare lette`
                  : `${syncResult.giornate} giornate lette`}
                {' · '}{syncResult.created} gare create · {syncResult.updated} aggiornate ·{' '}
                {syncResult.officialsUpdated} designazioni aggiornate
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setSyncResult(null)}>Chiudi</button>
          </div>

          {syncResult.unresolved?.length ? (
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ marginBottom: '6px' }}>Nominativi da associare ({syncResult.unresolved.length})</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
                Apri la gara per confermare l'associazione all'anagrafica: verrà ricordata per le prossime sincronizzazioni.
              </p>
              <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                {syncResult.unresolved.map((item, idx) => (
                  <li key={idx}>
                    <strong>{item.externalName}</strong> — gara {formatMatchNumber(item.matchNumber)} ({ROLE_LABELS[item.role] || item.role})
                    {item.candidates?.length ? (
                      <span style={{ color: 'var(--muted)' }}>
                        {' '}· candidati: {item.candidates.map((c) => c.fullName).join(', ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {syncResult.conflicts?.length ? (
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ marginBottom: '6px' }}>Conflitti da verificare ({syncResult.conflicts.length})</h3>
              <div className="table-scroll">
                <table className="referee-table">
                  <thead>
                    <tr>
                      <th>Gara</th>
                      <th>Campo</th>
                      <th>Valore attuale</th>
                      <th>Valore in arrivo</th>
                      <th>Origini</th>
                      <th>Azione proposta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.conflicts.map((c, idx) => (
                      <tr key={idx}>
                        <td style={{ fontFamily: 'monospace' }}>{formatMatchNumber(c.matchNumber)}</td>
                        <td>{c.field}</td>
                        <td>{c.currentValue || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{c.incomingValue || '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>{c.currentSource} → {c.incomingSource}</td>
                        <td style={{ color: 'var(--muted)' }}>{c.proposal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {syncResult.errors?.length ? (
            <div>
              <h3 style={{ marginBottom: '6px', color: 'var(--danger)' }}>Errori ({syncResult.errors.length})</h3>
              <ul style={{ paddingLeft: '18px' }}>
                {syncResult.errors.map((e, idx) => (
                  <li key={idx}>{e.matchNumber ? `Gara ${formatMatchNumber(e.matchNumber)}: ` : ''}{e.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!syncResult.unresolved?.length && !syncResult.conflicts?.length && !syncResult.errors?.length ? (
            <p>Nessun conflitto e nessun nominativo da associare.</p>
          ) : null}

          <div style={{ marginTop: '10px' }}>
            <button type="button" className="primary-button" onClick={() => navigate('/games')}>
              Vai alle gare
            </button>
          </div>
        </section>
      ) : null}

      {showForm ? (
        <form className="common-card" onSubmit={handleCreate}>
          <div className="section-heading">
            <div>
              <h2>Nuova sorgente</h2>
              <p>
                {form.sourceType === 'fip_analytics'
                  ? 'Scegli il campionato FIP: viene creata una sorgente per ogni girone, con calendario e designazioni visibili appena il designatore le carica (anche quelle ancora temporanee).'
                  : 'Apri fip.it → Risultati → seleziona campionato e fase, poi copia qui l’indirizzo della pagina: i gironi vengono trovati da soli e viene creata una sorgente per ognuno. Sono accettati solo link https del sito fip.it.'}
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annulla</button>
          </div>

          <SegmentedChoice
            label="Da dove arrivano le gare"
            compact
            options={Object.values(SOURCE_TYPE_LABELS)}
            value={SOURCE_TYPE_LABELS[form.sourceType]}
            onChange={(label) => updateForm('sourceType', SOURCE_TYPE_BY_LABEL[label])}
          />

          {form.sourceType === 'fip_analytics' && !analyticsConfigured ? (
            <div className="warning-banner" style={{ marginTop: 'var(--space-3)' }}>
              Credenziali FIP Analytics non configurate: impostare FIP_ANALYTICS_USERNAME e FIP_ANALYTICS_PASSWORD
              nelle variabili d’ambiente del server e riavviarlo.
            </div>
          ) : null}
          {form.sourceType === 'fip_analytics' && campionati.status === 'error' ? (
            <div className="error-banner" style={{ marginTop: 'var(--space-3)' }}>{campionati.error}</div>
          ) : null}

          <div className="common-grid" style={{ marginTop: 'var(--space-3)' }}>
            <div className="field field-span-3">
              <span>Stagione della nuova sorgente</span>
              <strong>{season}</strong>
            </div>
            {form.sourceType === 'fip_analytics' ? (
              <label className="field field-span-3">
                <span className="required-label">Campionato FIP <small className="required-symbol">*</small></span>
                <Select
                  value={form.codCampionato}
                  onChange={(v) => updateForm('codCampionato', v)}
                  disabled={!analyticsConfigured || campionati.status !== 'ready'}
                  placeholder={
                    campionati.status === 'loading'
                      ? 'Leggo i campionati da FIP Analytics…'
                      : campionati.list.length || campionati.status !== 'ready'
                        ? '— Seleziona —'
                        : 'Nessun campionato visibile per questa stagione'
                  }
                  options={campionati.list.map((c) => ({ value: c.code, label: `${c.label} (${c.code})` }))}
                  searchable
                />
              </label>
            ) : (
              <label className="field field-span-3">
                <span className="required-label">Link FIP del girone <small className="required-symbol">*</small></span>
                <input
                  value={form.url}
                  onChange={(e) => updateForm('url', e.target.value)}
                  placeholder="https://fip.it/risultati/?...&codice_girone=..."
                  required
                />
              </label>
            )}
            <label className="field field-span-3">
              Nome visualizzato (con più gironi diventa un prefisso, es. "DR1 — Girone A")
              <input value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="es. DR1" />
            </label>
            <label className="field field-span-2">
              {form.sourceType === 'fip_analytics' ? (
                <span className="required-label">Campionato della web app <small className="required-symbol">*</small></span>
              ) : (
                'Campionato'
              )}
              <Select
                value={form.competition}
                onChange={(v) => updateForm('competition', v)}
                placeholder="— Seleziona —"
                options={activeCompetitions.map((c) => ({ value: c.value, label: c.label }))}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annulla</button>
            <button
              type="submit"
              className="primary-button"
              disabled={
                busy ||
                (form.sourceType === 'fip_analytics' && (!analyticsConfigured || !form.codCampionato || !form.competition))
              }
            >
              {busy ? 'Creazione...' : 'Crea sorgente'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Sorgenti configurate ({sources.length})</h2>
            <p>Una stagione può avere più sorgenti: regular season, fasi finali, coppe.</p>
          </div>
        </div>

        {loading ? <ListSkeleton rows={4} /> : null}

        {!loading && sources.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
            Nessuna sorgente configurata. Clicca "+ Nuova sorgente" e scegli il campionato su FIP Analytics
            oppure incolla il link FIP del girone.
          </div>
        ) : null}

        {!loading && sources.length > 0 ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {sources.map((source) => (
              <div key={source.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: '1 1 260px' }}>
                    {renaming === source.id ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(source);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          autoFocus
                          style={{ flex: '1 1 180px' }}
                        />
                        <button type="button" className="primary-button" onClick={() => handleRename(source)} disabled={busy}>Salva</button>
                        <button type="button" className="ghost-button" onClick={() => setRenaming(null)}>Annulla</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <strong>{source.name}</strong>
                        <span className={`status-badge status-badge-sm ${source.sourceType === 'fip_analytics' ? 'status-info' : 'status-neutral'}`}>
                          {SOURCE_TYPE_LABELS[source.sourceType] || source.sourceType}
                        </span>
                      </div>
                    )}
                    <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                      {source.sportSeason}
                      {source.competition ? ` · ${source.competition}` : ''}
                      {source.sourceType === 'fip_analytics' && source.params?.cod_campionato
                        ? ` · Campionato FIP ${source.params.cod_campionato}${source.params.fase ? `, ${source.params.fase}` : ''}`
                        : ''}
                      {' · '}
                      Ultima sincronizzazione: {formatDateTime(source.lastSyncedAt)}
                      {source.lastSyncStatus ? ` (${SYNC_STATUS_LABELS[source.lastSyncStatus] || source.lastSyncStatus})` : ''}
                    </div>
                    {source.sourceType === 'fip_analytics' && analyticsSync && !analyticsConfigured ? (
                      <div style={{ color: 'var(--orange-ink)', fontSize: '0.82rem' }}>
                        Sincronizzazione non disponibile: credenziali FIP Analytics assenti sul server.
                      </div>
                    ) : null}
                    {source.sourceType === 'fip_public' && source.active && analyticsCovered.has(`${source.sportSeason}|${source.competition}`) ? (
                      <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                        Sulle gare che arrivano anche da FIP Analytics, da qui si aggiornano solo risultato e stato.
                      </div>
                    ) : null}
                  </div>
                  <span className={`status-badge ${source.active ? 'status-final' : 'status-draft'}`} style={{ padding: '3px 8px', fontSize: '0.72rem' }}>
                    {source.active ? 'Attiva' : 'Disattivata'}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => handleSync(source)}
                      disabled={Boolean(syncingId) || !source.active || (source.sourceType === 'fip_analytics' && !analyticsConfigured)}
                    >
                      {syncingId === source.id ? 'Sincronizzo…' : 'Sincronizza'}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => startRename(source)}>
                      Rinomina
                    </button>
                    <button type="button" className="ghost-button" onClick={() => toggleRuns(source.id)}>
                      {expandedRuns === source.id ? 'Nascondi storico' : 'Storico'}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => toggleActive(source)}>
                      {source.active ? 'Disattiva' : 'Riattiva'}
                    </button>
                    <button type="button" className="danger-button" onClick={() => setDeleting(source)}>
                      Elimina
                    </button>
                  </div>
                </div>

                {expandedRuns === source.id ? (
                  <div className="table-scroll" style={{ marginTop: '10px' }}>
                    {(runsBySource[source.id] || []).length ? (
                      <table className="referee-table">
                        <thead>
                          <tr>
                            <th>Avviata</th>
                            <th>Da</th>
                            <th>Esito</th>
                            <th>Create</th>
                            <th>Aggiornate</th>
                            <th>Conflitti</th>
                            <th>Errori</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(runsBySource[source.id] || []).map((run) => (
                            <tr key={run.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(run.startedAt)}</td>
                              <td>{run.startedByName || '—'}</td>
                              <td>{SYNC_STATUS_LABELS[run.status] || run.status}</td>
                              <td>{run.createdCount}</td>
                              <td>{run.updatedCount}</td>
                              <td style={{ color: run.conflictCount ? 'var(--orange)' : 'inherit' }}>{run.conflictCount}</td>
                              <td style={{ color: run.errorCount ? 'var(--danger)' : 'inherit' }}>{run.errorCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="empty-state" style={{ padding: '12px' }}>Nessuna sincronizzazione eseguita.</div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {deleting ? (
        <ConfirmModal
          title={`Eliminare la sorgente "${deleting.name}"?`}
          confirmLabel="Elimina sorgente"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        >
          Le gare già importate restano nel database e non vengono toccate. Verrà rimossa solo la
          configurazione della sorgente e la possibilità di sincronizzare.
        </ConfirmModal>
      ) : null}
    </div>
  );
}
