import { useEffect, useRef, useState } from 'react';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import { api, downloadReportPdf } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Select from '../components/Select.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const STAT_PILLS = [
  { key: 'total',      label: 'Totale' },
  { key: 'final',      label: 'Definitivi' },
  { key: 'draft',      label: 'Bozze' },
  { key: 'last_month', label: 'Ultimi 30gg' }
];

const CURRENT_SEASON = currentSportSeason();

function dateValue(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatReportDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('it-IT');
  } catch (_) {
    return value;
  }
}

export default function DashboardPage({ currentUser }) {
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [observer, setObserver] = useState('');
  const [observers, setObservers] = useState([]);
  const [season, setSeason] = useState(CURRENT_SEASON);
  const [viewMode, setViewMode] = useState('detailed');
  const [sortOrder, setSortOrder] = useState('updated-desc');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingId, setExportingId] = useState(null);
  const [reportToDelete, setReportToDelete] = useState(null);
  const archiveRef = useRef(null);

  useEffect(() => {
    if (!archiveOpen) return;
    function handleClick(e) {
      if (archiveRef.current && !archiveRef.current.contains(e.target)) {
        setArchiveOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setArchiveOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [archiveOpen]);

  useEffect(() => {
    api.getReportStats({ season }).then((data) => setStats(data.stats)).catch(() => {});
    api.listReportObservers({ season })
      .then((data) => {
        const nextObservers = data.observers || [];
        setObservers(nextObservers);
        setObserver((current) => current && !nextObservers.includes(current) ? '' : current);
      })
      .catch(() => {
        setObservers([]);
        setObserver('');
      });
  }, [season]);

  async function loadReports(nextSearch = search, nextStatus = status, nextSeason = season, nextObserver = observer) {
    setLoading(true);
    setError('');
    try {
      const data = await api.listReports({ search: nextSearch, status: nextStatus, season: nextSeason, observer: nextObserver });
      setReports(data.reports);
    } catch (err) {
      setError(err.message || 'Impossibile caricare i rapporti.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.listReports({ search, status, season, observer });
        if (!ignore) setReports(data.reports);
      } catch (err) {
        if (!ignore) setError(err.message || 'Impossibile caricare i rapporti.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }, search ? 280 : 0);

    return () => {
      ignore = true;
      window.clearTimeout(timeout);
    };
  }, [search, status, season, observer]);

  const seasonOptions = Array.from(new Set([CURRENT_SEASON, ...(stats?.seasons || [])]));
  const canFilterObservers = currentUser?.role === 'admin' || currentUser?.role === 'instructor';
  const hasFilters = Boolean(search || status || observer || season !== CURRENT_SEASON);
  const sortedReports = [...reports].sort((a, b) => {
    if (sortOrder === 'report-date-asc') {
      return dateValue(a.reportDate) - dateValue(b.reportDate) || a.id - b.id;
    }
    if (sortOrder === 'report-date-desc') {
      return dateValue(b.reportDate) - dateValue(a.reportDate) || b.id - a.id;
    }
    return dateValue(b.updatedAt) - dateValue(a.updatedAt) || b.id - a.id;
  });

  async function handleDelete() {
    if (!reportToDelete) return;
    try {
      await api.deleteReport(reportToDelete.id);
      setReportToDelete(null);
      await loadReports(search, status, season, observer);
      api.getReportStats({ season }).then((data) => setStats(data.stats)).catch(() => {});
    } catch (err) {
      setError(err.message || 'Cancellazione non riuscita.');
    }
  }

  async function handleExport(report) {
    setExportingId(report.id);
    try {
      await api.exportReport(report.id);
      downloadReportPdf(report.id, 'first');
      window.setTimeout(() => downloadReportPdf(report.id, 'second'), 650);
    } catch (err) {
      setError(err.message || 'Export PDF non riuscito.');
    } finally {
      setExportingId(null);
    }
  }

  function canManageReport(report) {
    return currentUser?.role === 'admin' || report.createdBy === currentUser?.id;
  }

  function formatReportVotes(report) {
    const first = report.firstRefereeVote ? `1°: ${report.firstRefereeVote}` : '';
    const second = report.secondRefereeVote ? `2°: ${report.secondRefereeVote}` : '';
    return [first, second].filter(Boolean).join(' · ') || '-';
  }

  return (
    <div className="page-stack">
      {reportToDelete ? (
        <ConfirmModal
          title="Cancella rapporto"
          confirmLabel="Sì, cancella"
          onConfirm={handleDelete}
          onCancel={() => setReportToDelete(null)}
        >
          Cancellare il rapporto gara <strong>{reportToDelete.matchNumber || reportToDelete.id}</strong>?
          {' '}L'operazione non può essere annullata.
        </ConfirmModal>
      ) : null}

      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Archivio locale</p>
          <h1>Rapporti pronti, bozze sotto controllo.</h1>
          <p>
            Compila due schede arbitro per ogni gara, salva bozze e genera PDF separati quando il rapporto è pronto.
          </p>
          {stats ? (
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
              {STAT_PILLS.map(({ key, label }) => (
                <div
                  key={key}
                  style={{
                    background: 'rgba(255,255,255,0.13)',
                    borderRadius: '10px',
                    padding: '8px 16px',
                    backdropFilter: 'blur(8px)',
                    textAlign: 'center',
                    minWidth: '68px'
                  }}
                >
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>
                    {stats[key] ?? 0}
                  </div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.72, marginTop: '3px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="hero-button" onClick={() => navigate('/reports/new')}>
          Nuovo rapporto
        </button>
      </section>

      <section className="toolbar-card">
        <div className="dashboard-controls">
          <input
            className="dashboard-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca..."
          />
          <Select
            value={status}
            onChange={setStatus}
            placeholder="Stato"
            options={[
              { value: '', label: 'Tutti' },
              { value: 'draft', label: 'Bozze' },
              { value: 'final', label: 'Definitivi' }
            ]}
          />
          {canFilterObservers ? (
            <Select
              value={observer}
              onChange={setObserver}
              placeholder="Osservatore"
              options={[
                { value: '', label: 'Tutti gli osservatori' },
                ...observers.map((name) => ({ value: name, label: name }))
              ]}
            />
          ) : null}
          <div className="view-switch" aria-label="Vista rapporti">
            <button
              type="button"
              className={viewMode === 'detailed' ? 'is-active' : ''}
              onClick={() => setViewMode('detailed')}
              title="Vista dettagliata"
              aria-label="Vista dettagliata"
            >
              <span>Vista dettagliata</span>
            </button>
            <button
              type="button"
              className={viewMode === 'compact' ? 'is-active' : ''}
              onClick={() => setViewMode('compact')}
              title="Vista compatta"
              aria-label="Vista compatta"
            >
              <span>Vista compatta</span>
            </button>
          </div>
          <div className="sort-control">
            <span className="sort-label" title="Ordinamento" aria-label="Ordinamento">
              <span aria-hidden="true">↓</span>
            </span>
            <Select
              value={sortOrder}
              onChange={setSortOrder}
              placeholder="Ordina"
              options={[
                { value: 'updated-desc', label: 'Modifica' },
                { value: 'report-date-desc', label: 'Data recente' },
                { value: 'report-date-asc', label: 'Data vecchia' }
              ]}
            />
          </div>
          <div className="archive-control" ref={archiveRef}>
            <button
              type="button"
              className={`ghost-button archive-button${season !== CURRENT_SEASON ? ' is-active' : ''}`}
              onClick={() => setArchiveOpen((open) => !open)}
            >
              {season === CURRENT_SEASON ? 'Archivio' : season}
            </button>
            {archiveOpen ? (
              <div className="archive-popover">
                <Select
                  value={season}
                  onChange={(value) => {
                    setSeason(value);
                    setArchiveOpen(false);
                  }}
                  placeholder="Anno sportivo"
                  options={seasonOptions.map((s) => ({
                    value: s,
                    label: s === CURRENT_SEASON ? `${s} · corrente` : s
                  }))}
                />
                {season !== CURRENT_SEASON ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setSeason(CURRENT_SEASON);
                      setArchiveOpen(false);
                    }}
                  >
                    Torna alla stagione corrente
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {hasFilters ? (
            <button
              type="button"
              className="ghost-button reset-filter-button"
              onClick={() => {
                setSearch('');
                setStatus('');
                setObserver('');
                setSeason(CURRENT_SEASON);
                setArchiveOpen(false);
              }}
            >
              Reset
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className={viewMode === 'compact' ? 'reports-compact-list' : 'reports-grid'}>
        {loading ? <div className="empty-state">Caricamento rapporti...</div> : null}
        {!loading && reports.length === 0 ? (
          <div className="empty-state">
            <h3>Nessun rapporto ancora.</h3>
            <p>Il primo fischio è sempre quello più rumoroso. Creiamo la prima bozza.</p>
            <button type="button" className="primary-button" onClick={() => navigate('/reports/new')}>
              Nuovo rapporto
            </button>
          </div>
        ) : null}

        {sortedReports.map((report) => viewMode === 'compact' ? (
          <article
            className="report-card compact-report-card"
            key={report.id}
            onClick={() => navigate(`/reports/${report.id}`)}
          >
            <span className="compact-match-number">Gara {report.matchNumber || report.id}</span>
            <strong>{report.teams || 'Squadre non inserite'}</strong>
            <time>{formatReportDate(report.reportDate)}</time>
          </article>
        ) : (
          <article
            className="report-card"
            key={report.id}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/reports/${report.id}`)}
          >
            <div className="report-card-top">
              <div>
                <span className="match-number">Gara {report.matchNumber || report.id}</span>
                <h2>{report.teams || 'Squadre non inserite'}</h2>
              </div>
              <StatusBadge status={report.status} />
            </div>
            <dl>
              <div>
                <dt>Campionato</dt>
                <dd>{report.competition || '-'}</dd>
              </div>
              <div>
                <dt>Osservatore</dt>
                <dd>{report.observerName || '-'}</dd>
              </div>
              <div>
                <dt>Risultato</dt>
                <dd>{report.result || '-'}</dd>
              </div>
              <div>
                <dt>Arbitri</dt>
                <dd>{report.firstRefereeName || '-'} / {report.secondRefereeName || '-'}</dd>
              </div>
              <div>
                <dt>Voti</dt>
                <dd>{formatReportVotes(report)}</dd>
              </div>
              <div>
                <dt>Aggiornato</dt>
                <dd>{new Date(report.updatedAt).toLocaleString('it-IT')}</dd>
              </div>
            </dl>
            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
              {canManageReport(report) ? (
                <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${report.id}/edit`)}>
                  Modifica
                </button>
              ) : null}
              <button type="button" className="ghost-button" onClick={() => handleExport(report)} disabled={exportingId === report.id}>
                {exportingId === report.id ? 'Genero...' : 'PDF'}
              </button>
              {canManageReport(report) ? (
                <button type="button" className="danger-button" onClick={() => setReportToDelete(report)}>
                  Cancella
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
