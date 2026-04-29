import { useEffect, useState } from 'react';
import { COMMON_MATCH_CHARACTERISTICS, EVALUATION_SECTIONS, getRefereeLabel } from '../../../shared/reportTemplate.js';
import { api, downloadReportPdf } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import StatusBadge from '../components/StatusBadge.jsx';

function CommentBlock({ title, children }) {
  return (
    <div className="comment-block">
      <h4>{title}</h4>
      <p>{children || '-'}</p>
    </div>
  );
}

function RefereeSummary({ role, report, onError }) {
  const [exporting, setExporting] = useState(false);
  const data = report.data;
  const evaluation = data.evaluations[role];
  const refereeName = role === 'first' ? data.firstRefereeName : data.secondRefereeName;

  async function handleDownload() {
    setExporting(true);
    try {
      await api.exportReport(report.id);
      downloadReportPdf(report.id, role);
    } catch (err) {
      onError(err.message || 'Download PDF non riuscito.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <article className="detail-ref-card">
      <div className="report-card-top">
        <div>
          <span className="match-number">{getRefereeLabel(role)}</span>
          <h2>{refereeName || '-'}</h2>
        </div>
        <button type="button" className="ghost-button" onClick={handleDownload} disabled={exporting}>
          {exporting ? 'Genero...' : 'Scarica PDF'}
        </button>
      </div>

      {EVALUATION_SECTIONS.filter((section) => section.commentLabel).map((section) => (
        <CommentBlock key={section.id} title={section.title}>
          {evaluation.sections[section.id]?.comment}
        </CommentBlock>
      ))}
      <CommentBlock title="Giudizio globale">{evaluation.globalJudgement}</CommentBlock>
      <CommentBlock title="Eventuali errori tecnici">{evaluation.technicalErrors}</CommentBlock>
    </article>
  );
}

export default function ReportDetailPage({ id }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.getReport(id)
      .then((data) => setReport(data.report))
      .catch((err) => setError(err.message || 'Rapporto non trovato.'));
  }, [id]);

  async function handleExportBoth() {
    setExporting(true);
    setError('');
    try {
      await api.exportReport(id);
      downloadReportPdf(id, 'first');
      window.setTimeout(() => downloadReportPdf(id, 'second'), 650);
    } catch (err) {
      setError(err.message || 'Export PDF non riuscito.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(`Cancellare il rapporto gara ${report.data.matchNumber || report.id}?`);
    if (!ok) return;
    await api.deleteReport(report.id);
    navigate('/');
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!report) return <div className="empty-state">Caricamento rapporto...</div>;

  const data = report.data;

  return (
    <div className="page-stack">
      <section className="detail-hero">
        <div>
          <p className="eyebrow">Dettaglio rapporto</p>
          <h1>Gara {data.matchNumber || report.id}</h1>
          <p>{data.teamHome || '-'} - {data.teamAway || '-'} · {data.scoreHome || '-'} - {data.scoreAway || '-'}</p>
        </div>
        <StatusBadge status={report.status} />
      </section>

      <section className="detail-meta-card">
        <dl>
          <div>
            <dt>Osservatore</dt>
            <dd>{data.observerName || '-'}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{data.reportDate || '-'}</dd>
          </div>
          <div>
            <dt>Campionato</dt>
            <dd>{data.competition || '-'}</dd>
          </div>
          <div>
            <dt>Aggiornato</dt>
            <dd>{new Date(report.updatedAt).toLocaleString('it-IT')}</dd>
          </div>
        </dl>
        <div className="detail-actions">
          <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${report.id}/edit`)}>
            Modifica
          </button>
          <button type="button" className="primary-button" onClick={handleExportBoth} disabled={exporting}>
            {exporting ? 'Genero PDF...' : 'Genera i 2 PDF'}
          </button>
          <button type="button" className="danger-button" onClick={handleDelete}>
            Cancella
          </button>
        </div>
      </section>

      <section className="detail-ref-card">
        <div className="report-card-top">
          <div>
            <span className="match-number">Comune</span>
            <h2>{COMMON_MATCH_CHARACTERISTICS.title}</h2>
          </div>
          <span className="status-badge status-final">
            {data.matchCharacteristics.ratings.difficulty || '-'}
          </span>
        </div>
        <CommentBlock title={COMMON_MATCH_CHARACTERISTICS.commentLabel}>
          {data.matchCharacteristics.comment}
        </CommentBlock>
      </section>

      <section className="detail-grid">
        <RefereeSummary role="first" report={report} onError={setError} />
        <RefereeSummary role="second" report={report} onError={setError} />
      </section>
    </div>
  );
}
