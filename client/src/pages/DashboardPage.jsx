import { useEffect, useState } from 'react';
import { api, downloadReportPdf } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function DashboardPage() {
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingId, setExportingId] = useState(null);

  async function loadReports(nextSearch = search, nextStatus = status) {
    setLoading(true);
    setError('');
    try {
      const data = await api.listReports({ search: nextSearch, status: nextStatus });
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
        const data = await api.listReports({ search, status });
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
  }, [search, status]);

  const hasFilters = Boolean(search || status);

  async function handleDelete(report) {
    const ok = window.confirm(`Cancellare il rapporto gara ${report.matchNumber || report.id}?`);
    if (!ok) return;
    await api.deleteReport(report.id);
    await loadReports();
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

  return (
    <div className="page-stack">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Archivio locale</p>
          <h1>Rapporti pronti, bozze sotto controllo.</h1>
          <p>
            Compila due schede arbitro per ogni gara, salva bozze e genera PDF separati quando il rapporto è pronto.
          </p>
        </div>
        <button type="button" className="hero-button" onClick={() => navigate('/reports/new')}>
          Nuovo rapporto
        </button>
      </section>

      <section className="toolbar-card">
        <div className="filter-form">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca gara, squadre, arbitro..."
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tutti gli stati</option>
            <option value="draft">Bozze</option>
            <option value="final">Definitivi</option>
          </select>
          {hasFilters ? (
            <button
              type="button"
              className="ghost-button reset-filter-button"
              onClick={() => {
                setSearch('');
                setStatus('');
              }}
            >
              Reset filtri
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="reports-grid">
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

        {reports.map((report) => (
          <article className="report-card" key={report.id}>
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
                <dt>Aggiornato</dt>
                <dd>{new Date(report.updatedAt).toLocaleString('it-IT')}</dd>
              </div>
            </dl>
            <div className="card-actions">
              <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${report.id}`)}>
                Apri
              </button>
              <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${report.id}/edit`)}>
                Modifica
              </button>
              <button type="button" className="ghost-button" onClick={() => handleExport(report)} disabled={exportingId === report.id}>
                {exportingId === report.id ? 'Genero...' : 'PDF'}
              </button>
              <button type="button" className="danger-button" onClick={() => handleDelete(report)}>
                Cancella
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
