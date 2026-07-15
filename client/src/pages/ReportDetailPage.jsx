import { useEffect, useState } from 'react';
import { COMMON_MATCH_CHARACTERISTICS, getRefereeLabel, deriveSeason } from '../../../shared/reportTemplate.js';
import { api, downloadReportPdf } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { formatMatchNumber } from '../lib/formatters.js';
import FederationPdfImporter from '../components/FederationPdfImporter.jsx';

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M6 9L1.5 4.5H4.5V1H7.5V4.5H10.5L6 9Z"/>
      <rect x="1" y="10.25" width="10" height="1.5" rx="0.75"/>
    </svg>
  );
}

function relativeDate(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  return new Date(value).toLocaleString('it-IT');
}

function RefereeSummary({ role, report, onError, emailEnabled, sentAt, onSent, canLinkReferee, isReferee, canEditDraft }) {
  const [exporting, setExporting] = useState(false);
  const [sending, setSending] = useState(false);
  const data = report.data;
  const evaluation = data.evaluations[role];
  if (!evaluation) return null;
  const refereeName = role === 'first' ? data.firstRefereeName : data.secondRefereeName;
  const refereeId = role === 'first' ? data.firstRefereeId : data.secondRefereeId;
  const isFinal = report.status === 'final';

  async function handleDownload() {
    setExporting(true);
    try {
      downloadReportPdf(report.id, role);
    } catch (err) {
      onError(err.message || 'Download PDF non riuscito.');
    } finally {
      setExporting(false);
    }
  }

  function handleOpenPdf() {
    window.open(`/api/reports/${report.id}/export/${role}/download?inline=1`, '_blank');
  }

  async function handleSendEmail() {
    setSending(true);
    try {
      const result = await api.sendReportEmail(report.id, role);
      onSent(role, result.sentAt);
    } catch (err) {
      onError(err.message || 'Invio email non riuscito.');
    } finally {
      setSending(false);
    }
  }

  function handleOpenCard() {
    if (isFinal) return;
    if (!canEditDraft) return;
    sessionStorage.setItem(`report-edit-role-${report.id}`, role);
    navigate(`/reports/${report.id}/edit`);
  }

  return (
    <article className="ref-card">
      {/* Header */}
      <div className="ref-card-header">
        <div>
          <p className="ref-card-eyebrow">{getRefereeLabel(role)}</p>
          <p className="ref-card-name">
            {refereeId && canLinkReferee ? (
              <button
                type="button"
                className="link-button"
                onClick={() => navigate(`/admin/referees/${refereeId}`)}
              >
                {refereeName || '—'}
              </button>
            ) : (refereeName || '—')}
          </p>
        </div>
        {evaluation.vote
          ? <div className="vote-box"><span className="vote-num">{evaluation.vote}</span><span className="vote-lbl">VOTO</span></div>
          : <div className="vote-box empty">—</div>
        }
      </div>

      {/* Body: solo giudizio globale — cliccabile per aprire PDF se definitivo */}
      <div
        className={`ref-card-body${isFinal ? ' is-clickable' : ''}`}
        onClick={isFinal ? handleOpenPdf : undefined}
        role={isFinal ? 'button' : undefined}
        tabIndex={isFinal ? 0 : undefined}
        onKeyDown={isFinal ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleOpenPdf(); } : undefined}
      >
        <p className="judgement-label">
          Giudizio globale
          {isFinal && <span className="judgement-pdf-hint"> · apri PDF</span>}
        </p>
        <p className="judgement-text">{evaluation.globalJudgement || '—'}</p>
      </div>

      {/* Footer */}
      <div className="ref-card-footer">
        <span className="sent-indicator">
          <span className={`sent-dot ${sentAt ? 'green' : 'orange'}`} />
          {sentAt ? `Inviato ${relativeDate(sentAt)}` : 'PDF non ancora inviato'}
        </span>
        <div className="ref-card-footer-actions">
          {isFinal && (
            <button type="button" className="ghost-button btn-with-icon" onClick={handleDownload} disabled={exporting}>
              {exporting ? '…' : <><DownloadIcon />PDF</>}
            </button>
          )}
          {isFinal && !isReferee && emailEnabled && (
            <button type="button" className="primary-button" onClick={handleSendEmail} disabled={sending}>
              {sending ? 'Invio…' : sentAt ? 'Reinvia' : 'Invia'}
            </button>
          )}
          {!isFinal && canEditDraft && (
            <button type="button" className="ghost-button" onClick={handleOpenCard}>
              Apri scheda
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ReportDetailPage({ id, currentUser }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPdfImporter, setShowPdfImporter] = useState(false);

  function loadReport() {
    return api.getReport(id)
      .then((data) => { setReport(data.report); setError(''); })
      .catch((err) => setError(err.message || 'Rapporto non trovato.'));
  }

  useEffect(() => {
    loadReport();
    api.isEmailEnabled()
      .then((data) => setEmailEnabled(data.enabled))
      .catch(() => {});
  }, [id]);

  async function handleExportBoth() {
    setExporting(true);
    setError('');
    try {
      await api.exportReport(id);
      downloadReportPdf(id, 'first');
      window.setTimeout(() => downloadReportPdf(id, 'second'), 1200);
    } catch (err) {
      setError(err.message || 'Export PDF non riuscito.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deleteReport(report.id);
      navigate(currentUser?.role === 'referee' ? '/me' : '/reports');
    } catch (err) {
      setError(err.message || 'Cancellazione non riuscita.');
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!report) return <div className="empty-state">Caricamento rapporto…</div>;

  const data = report.data;
  const isReferee = currentUser?.role === 'referee';
  const canManageReport = !isReferee && (
    currentUser?.role === 'admin' ||
    report.createdBy === currentUser?.id ||
    (report.observerId && report.observerId === currentUser?.id)
  );
  const canLinkReferee = currentUser?.role === 'admin' ||
    (currentUser?.role === 'instructor' && Boolean(currentUser?.instructorCompetitions?.length || currentUser?.instructorCompetition));
  const canImportPdf = currentUser?.role === 'admin' || currentUser?.role === 'instructor';

  const scoreHome = Number(data.scoreHome);
  const scoreAway = Number(data.scoreAway);
  const hasScores = data.scoreHome && data.scoreAway;
  const isHomeWinner = hasScores && scoreHome > scoreAway;
  const isAwayWinner = hasScores && scoreAway > scoreHome;

  const season = report.sportSeason || deriveSeason(data.reportDate) || '—';

  return (
    <div className="page-stack">
      {showPdfImporter ? (
        <FederationPdfImporter
          gameId={report.gameId}
          reportId={report.id}
          onClose={() => setShowPdfImporter(false)}
          onImported={() => loadReport()}
        />
      ) : null}
      {showDeleteConfirm ? (
        <ConfirmModal
          title="Cancella rapporto"
          confirmLabel="Sì, cancella"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        >
          Cancellare il rapporto gara <strong>{formatMatchNumber(data.matchNumber, report.id)}</strong>?
          {' '}L'operazione non può essere annullata.
        </ConfirmModal>
      ) : null}

      {/* Hero risultato */}
      <section className="detail-hero">
        <div className="detail-hero-top">
          <div className="detail-hero-content">
            <p className="eyebrow">
              #{formatMatchNumber(data.matchNumber, report.id)}
              {data.competition ? ` · ${data.competition}` : ''}
              {data.reportDate ? ` · ${new Date(data.reportDate).toLocaleDateString('it-IT')}` : ''}
            </p>
            <div className="score-block">
              <div className="team-block">
                <span className="team-name">{data.teamHome || '—'}</span>
                <span className={`team-score${isHomeWinner ? ' winner' : ''}`}>{data.scoreHome || '—'}</span>
              </div>
              <span className="vs-label">vs</span>
              <div className="team-block" style={{ textAlign: 'right' }}>
                <span className="team-name">{data.teamAway || '—'}</span>
                <span className={`team-score${isAwayWinner ? ' winner' : ''}`}>{data.scoreAway || '—'}</span>
              </div>
            </div>
          </div>
          <div className="detail-hero-actions">
            {canImportPdf && (
              <button type="button" className="accent-button" onClick={() => setShowPdfImporter(true)}>
                Aggiorna da PDF federali
              </button>
            )}
            {canManageReport && (
              <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${report.id}/edit`)}>
                Modifica
              </button>
            )}
            {!isReferee && (
              <button type="button" className="ghost-button btn-with-icon" onClick={handleExportBoth} disabled={exporting}>
                {exporting ? 'Genero…' : <><DownloadIcon />Genera PDF</>}
              </button>
            )}
          </div>
        </div>
        <div className="detail-hero-bottom">
          <StatusBadge status={report.status} />
          {canManageReport && (
            <button type="button" className="hero-delete-button" onClick={() => setShowDeleteConfirm(true)}>
              Cancella rapporto
            </button>
          )}
        </div>
      </section>

      {/* Meta strip — 4 colonne */}
      <dl className="meta-strip">
        <div className="meta-cell">
          <dt>N° gara</dt>
          <dd>{formatMatchNumber(data.matchNumber)}</dd>
        </div>
        <div className="meta-cell">
          <dt>Osservatore</dt>
          <dd>{data.observerName || '—'}</dd>
        </div>
        <div className="meta-cell">
          <dt>Stagione</dt>
          <dd>{season}</dd>
        </div>
        <div className="meta-cell">
          <dt>Aggiornato</dt>
          <dd>{relativeDate(report.updatedAt)}</dd>
        </div>
      </dl>

      {/* Caratteristiche gara (comune) */}
      <section className="common-card">
        <div className="section-heading">
          <div>
            <span className="match-number">Comune</span>
            <h2>{COMMON_MATCH_CHARACTERISTICS.title}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {data.matchCharacteristics?.ratings?.difficulty ? (
              <span className="difficulty-pill">
                Difficoltà {data.matchCharacteristics.ratings.difficulty}
              </span>
            ) : null}
            <span className="shared-pill">Comune ai due arbitri</span>
          </div>
        </div>
        {data.matchCharacteristics?.comment ? (
          <div className="comment-block">
            <h4>{COMMON_MATCH_CHARACTERISTICS.commentLabel}</h4>
            <p>{data.matchCharacteristics.comment}</p>
          </div>
        ) : null}
      </section>

      {/* Schede arbitri */}
      <section className={isReferee ? 'detail-ref-stack' : 'detail-grid'}>
        {data.evaluations.first ? (
          <RefereeSummary
            role="first"
            report={report}
            onError={setError}
            emailEnabled={emailEnabled}
            sentAt={report.firstRefereeSentAt}
            onSent={(role, sentAt) => setReport((r) => ({ ...r, firstRefereeSentAt: sentAt }))}
            canLinkReferee={canLinkReferee}
            isReferee={isReferee}
            canEditDraft={canManageReport && report.status !== 'final'}
          />
        ) : null}
        {data.evaluations.second ? (
          <RefereeSummary
            role="second"
            report={report}
            onError={setError}
            emailEnabled={emailEnabled}
            sentAt={report.secondRefereeSentAt}
            onSent={(role, sentAt) => setReport((r) => ({ ...r, secondRefereeSentAt: sentAt }))}
            canLinkReferee={canLinkReferee}
            isReferee={isReferee}
            canEditDraft={canManageReport && report.status !== 'final'}
          />
        ) : null}
      </section>
    </div>
  );
}
