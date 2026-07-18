import { useEffect, useState } from 'react';
import { api, downloadReportPdf } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { useCompetitions } from '../lib/competitions.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Select from '../components/Select.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import WorkbenchTable from '../components/WorkbenchTable.jsx';
import FilterBar from '../components/FilterBar.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { formatMatchNumber, formatDateTime } from '../lib/formatters.js';
import FederationPdfImporter from '../components/FederationPdfImporter.jsx';
import ListSkeleton from '../components/ListSkeleton.jsx';

function dateValue(value) {
  const t = new Date(value || '').getTime();
  return Number.isFinite(t) ? t : 0;
}

function buildSparkline(total, lastMonth) {
  const bars = 10;
  const avg = total > 0 ? total / bars : 0;
  const values = Array.from({ length: bars }, (_, i) => {
    const base = Math.max(1, Math.round(avg * (0.6 + Math.random() * 0.8)));
    return i === bars - 1 ? (lastMonth || Math.round(avg)) : base;
  });
  const max = Math.max(...values, 1);
  return values.map((v) => Math.max(2, Math.round((v / max) * 22)));
}

export default function DashboardPage({ currentUser, season }) {
  const [reports, setReports] = useState([]);
  const [pendingGames, setPendingGames] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [competition, setCompetition] = useState('');
  const [observer, setObserver] = useState('');
  const [observers, setObservers] = useState([]);
  const [sortColumn, setSortColumn] = useState('updatedAt');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingId, setExportingId] = useState(null);
  const [reportToDelete, setReportToDelete] = useState(null);
  const [showPdfImporter, setShowPdfImporter] = useState(false);
  const { competitionLabel } = useCompetitions();
  const [sparkline] = useState(() => buildSparkline(0, 0));

  useEffect(() => {
    setCompetition('');
    api.getReportStats({ season }).then((data) => setStats(data.stats)).catch(() => {});
    api.listReportObservers({ season })
      .then((data) => {
        const next = data.observers || [];
        setObservers(next);
        setObserver((cur) => cur && !next.includes(cur) ? '' : cur);
      })
      .catch(() => { setObservers([]); setObserver(''); });
    api.getPendingGames({ season })
      .then((data) => setPendingGames(data.games || []))
      .catch(() => setPendingGames([]));
  }, [season]);

  async function loadReports(s = search, se = season, ob = observer) {
    setLoading(true);
    setError('');
    try {
      const data = await api.listReports({ search: s, season: se, observer: ob });
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
        const data = await api.listReports({ search, season, observer });
        if (!ignore) setReports(data.reports);
      } catch (err) {
        if (!ignore) setError(err.message || 'Impossibile caricare i rapporti.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }, search ? 280 : 0);
    return () => { ignore = true; window.clearTimeout(timeout); };
  }, [search, season, observer]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        navigate('/reports/new');
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const canFilterObservers = currentUser?.role === 'admin' || currentUser?.role === 'instructor';
  const isReferee = currentUser?.role === 'referee';
  const canImportPdf = currentUser?.role === 'admin' || currentUser?.role === 'instructor';
  const filterCount = [competition, observer].filter(Boolean).length;
  const availableCompetitions = Array.from(new Set(reports.map((r) => r.competition).filter(Boolean))).sort();

  const sortedReports = [...reports].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortColumn === 'reportDate') return dir * (dateValue(a.reportDate) - dateValue(b.reportDate) || a.id - b.id);
    if (sortColumn === 'matchNumber') return dir * ((a.matchNumber || '').localeCompare(b.matchNumber || ''));
    if (sortColumn === 'firstRefereeVote') return dir * ((Number(a.firstRefereeVote) || 0) - (Number(b.firstRefereeVote) || 0));
    return dir * (dateValue(a.updatedAt) - dateValue(b.updatedAt) || b.id - a.id);
  });

  function handleSort(col) {
    if (sortColumn === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDir('desc'); }
  }

  function resetFilters() {
    setSearch('');
    setCompetition('');
    setObserver('');
  }

  async function handleDelete() {
    if (!reportToDelete) return;
    try {
      await api.deleteReport(reportToDelete.id);
      setReportToDelete(null);
      await loadReports();
      api.getReportStats({ season }).then((d) => setStats(d.stats)).catch(() => {});
    } catch (err) {
      setError(err.message || 'Cancellazione non riuscita.');
    }
  }

  async function handleExport(report) {
    setExportingId(report.id);
    try {
      await api.exportReport(report.id);
      downloadReportPdf(report.id, 'first');
      window.setTimeout(() => downloadReportPdf(report.id, 'second'), 1200);
    } catch (err) {
      setError(err.message || 'Export PDF non riuscito.');
    } finally {
      setExportingId(null);
    }
  }

  function canManage(report) {
    return (
      currentUser?.role === 'admin' ||
      report.createdBy === currentUser?.id ||
      (report.observerId && report.observerId === currentUser?.id)
    );
  }

  function handleNavigate(id, mode) {
    navigate(mode === 'edit' ? `/reports/${id}/edit` : `/reports/${id}`);
  }

  const kpiSparkline = stats ? buildSparkline(stats.total, stats.last_month) : sparkline;

  return (
    <div className="page-stack">
      {showPdfImporter ? (
        <FederationPdfImporter
          onClose={() => setShowPdfImporter(false)}
          onImported={() => {
            loadReports();
            api.getReportStats({ season }).then((data) => setStats(data.stats)).catch(() => {});
            api.getPendingGames({ season }).then((data) => setPendingGames(data.games || [])).catch(() => {});
          }}
        />
      ) : null}
      {reportToDelete ? (
        <ConfirmModal
          title="Cancella rapporto"
          confirmLabel="Sì, cancella"
          onConfirm={handleDelete}
          onCancel={() => setReportToDelete(null)}
        >
          Cancellare il rapporto gara <strong>{formatMatchNumber(reportToDelete.matchNumber, reportToDelete.id)}</strong>?
          {' '}L'operazione non può essere annullata.
        </ConfirmModal>
      ) : null}

      {/* Hero compatto */}
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Workbench · stagione {season}</p>
          <h1>{stats?.total ?? '—'} rapporti, sotto controllo.</h1>
        </div>
        <div className="hero-actions">
          {canImportPdf ? (
            <button type="button" className="ghost-button" onClick={() => setShowPdfImporter(true)}>
              Importa PDF
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={() => navigate('/reports/new')}>
            + Nuovo rapporto
          </button>
        </div>
      </section>

      {/* KPI strip */}
      {stats ? (
        <div className="kpi-strip">
          <div className="kpi-cell">
            <span className="kpi-label">Totale</span>
            <span className="kpi-value">{stats.total}</span>
            <div className="kpi-sparkline">
              {kpiSparkline.map((h, i) => (
                <div key={i} className="kpi-bar" style={{ height: h }} />
              ))}
            </div>
          </div>
          <div className="kpi-cell">
            <span className="kpi-label">Definitivi</span>
            <span className="kpi-value kpi-green">{stats.final ?? 0}</span>
            <span className="kpi-footer">pronti</span>
          </div>
          <div className="kpi-cell">
            <span className="kpi-label">Bozze aperte</span>
            <span className="kpi-value kpi-amber">{stats.draft ?? 0}</span>
            <span className="kpi-footer">in lavorazione</span>
          </div>
          <div className="kpi-cell">
            <span className="kpi-label">Ultimi 30gg</span>
            <span className="kpi-value">{stats.last_month ?? 0}</span>
            <span className="kpi-footer">aggiornati</span>
          </div>
          <div className="kpi-cell">
            <span className="kpi-label">Stagioni</span>
            <span className="kpi-value">{stats.seasons?.length ?? 1}</span>
            <span className="kpi-footer">in archivio</span>
          </div>
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      {/* Da compilare: gare per cui l'utente è osservatore designato, senza rapporto */}
      {!isReferee && pendingGames.length > 0 ? (
        <div className="common-card">
          <div className="section-heading">
            <div>
              <h2>Da compilare ({pendingGames.length})</h2>
              <p>Gare in cui sei designato come osservatore e non hanno ancora un rapporto.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="referee-table">
              <thead>
                <tr>
                  <th>N. gara</th>
                  <th>Data</th>
                  <th>Incontro</th>
                  <th>1° arbitro</th>
                  <th>2° arbitro</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingGames.map((g) => (
                  <tr key={g.gameId} className="is-clickable" onClick={() => navigate(`/reports/new?game=${g.gameId}`)}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{formatMatchNumber(g.matchNumber)}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{formatDateTime(g.scheduledAt)}</td>
                    <td style={{ fontWeight: 600 }}>{g.teamHome} - {g.teamAway}</td>
                    <td>{g.referee1 || '—'}</td>
                    <td>{g.referee2 || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/reports/new?game=${g.gameId}`); }}
                      >
                        Compila
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Tabella workbench */}
      <div className="workbench-card">
        <div className="workbench-card-header">
          <span className="workbench-card-title">
            Tutti i rapporti · <strong>{sortedReports.filter((r) => !competition || r.competition === competition).length}</strong> risultati
          </span>
        </div>

        <div className="workbench-filters">
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Cerca gara, squadra, arbitro…' }}
            activeCount={filterCount}
            onReset={resetFilters}
          >
            {availableCompetitions.length > 0 && (
              <Select
                value={competition}
                onChange={setCompetition}
                placeholder="Campionato"
                options={[
                  { value: '', label: 'Tutti i campionati' },
                  ...availableCompetitions.map((c) => ({ value: c, label: competitionLabel(c) }))
                ]}
              />
            )}
            {canFilterObservers && (
              <Select
                value={observer}
                onChange={setObserver}
                placeholder="Osservatore"
                options={[
                  { value: '', label: 'Tutti gli osservatori' },
                  ...observers.map((n) => ({ value: n, label: n }))
                ]}
              />
            )}
          </FilterBar>
        </div>

        <div className="workbench-body">
          {loading ? (
            <ListSkeleton rows={6} />
          ) : sortedReports.length === 0 ? (
            <EmptyState
              title="Nessun rapporto ancora."
              action={(
                <button type="button" className="primary-button" onClick={() => navigate('/reports/new')}>
                  + Nuovo rapporto
                </button>
              )}
            >
              Il primo fischio è sempre quello più rumoroso. Creiamo la prima bozza.
            </EmptyState>
          ) : (
            <WorkbenchTable
              reports={sortedReports.filter((r) => !competition || r.competition === competition)}
              sortColumn={sortColumn}
              sortDir={sortDir}
              onSort={handleSort}
              onNavigate={handleNavigate}
              onExport={handleExport}
              onDelete={(r) => setReportToDelete(r)}
              exportingId={exportingId}
              canManage={canManage}
              currentUser={currentUser}
            />
          )}
        </div>
      </div>
    </div>
  );
}
