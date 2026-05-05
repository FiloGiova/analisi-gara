import { useEffect, useState } from 'react';
import { COMMON_MATCH_CHARACTERISTICS, getRefereeLabel } from '../../../shared/reportTemplate.js';
import { api, downloadReportPdf } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

function CommentBlock({ title, children }) {
  return (
    <div className="comment-block">
      <h4>{title}</h4>
      <p>{children || '-'}</p>
    </div>
  );
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
  const canOpenCard = isFinal || canEditDraft;

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
    const link = document.createElement('a');
    link.href = `/api/reports/${report.id}/export/${role}/download?inline=1`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.click();
  }

  function handleOpenCard() {
    if (isFinal) {
      handleOpenPdf();
      return;
    }
    if (!canEditDraft) return;
    sessionStorage.setItem(`report-edit-role-${report.id}`, role);
    navigate(`/reports/${report.id}/edit`);
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

  return (
    <article
      className={[
        'detail-ref-card',
        'detail-ref-summary-card',
        canOpenCard ? 'is-clickable' : '',
        isFinal ? 'opens-pdf' : ''
      ].filter(Boolean).join(' ')}
      onClick={handleOpenCard}
      role={canOpenCard ? 'button' : undefined}
      tabIndex={canOpenCard ? 0 : undefined}
      onKeyDown={(event) => {
        if (!canOpenCard) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenCard();
        }
      }}
    >
      <div className="report-card-top">
        <div>
          <span className="match-number">{getRefereeLabel(role)}</span>
          <h2>
            {refereeId && canLinkReferee ? (
              <button
                type="button"
                className="link-button"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/admin/referees/${refereeId}`);
                }}
              >
                {refereeName || '-'}
              </button>
            ) : refereeName || '-'}
          </h2>
        </div>
        <div className="referee-summary-actions" onClick={(event) => event.stopPropagation()}>
          {isFinal ? (
            <>
              <button type="button" className="ghost-button" onClick={handleDownload} disabled={exporting}>
                {exporting ? 'Genero...' : 'Scarica PDF'}
              </button>
            </>
          ) : canEditDraft ? (
            <button type="button" className="ghost-button" onClick={handleOpenCard}>
              Apri scheda
            </button>
          ) : null}
          {isFinal && !isReferee && emailEnabled ? (
            <button type="button" className="ghost-button" onClick={handleSendEmail} disabled={sending}>
              {sending ? 'Invio...' : sentAt ? 'Invia di nuovo' : 'Invia PDF all\'arbitro'}
            </button>
          ) : null}
          {isFinal && !isReferee && sentAt ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Inviato il {new Date(sentAt).toLocaleString('it-IT')}
            </span>
          ) : null}
        </div>
      </div>

      <div className="referee-summary-body">
        <CommentBlock title="Giudizio globale">{evaluation.globalJudgement}</CommentBlock>
        {!isReferee ? (
          <div className="vote-summary">
            <span>Voto</span>
            <strong>{evaluation.vote || '-'}</strong>
          </div>
        ) : null}
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

  useEffect(() => {
    api.getReport(id)
      .then((data) => setReport(data.report))
      .catch((err) => setError(err.message || 'Rapporto non trovato.'));
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
      window.setTimeout(() => downloadReportPdf(id, 'second'), 650);
    } catch (err) {
      setError(err.message || 'Export PDF non riuscito.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deleteReport(report.id);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Cancellazione non riuscita.');
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!report) return <div className="empty-state">Caricamento rapporto...</div>;

  const data = report.data;
  const isReferee = currentUser?.role === 'referee';
  const canManageReport = !isReferee && (currentUser?.role === 'admin' || report.createdBy === currentUser?.id);
  const canLinkReferee = currentUser?.role === 'admin' ||
    (currentUser?.role === 'instructor' && Boolean(currentUser?.instructorCompetitions?.length || currentUser?.instructorCompetition));

  return (
    <div className="page-stack">
      {showDeleteConfirm ? (
        <ConfirmModal
          title="Cancella rapporto"
          confirmLabel="Sì, cancella"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        >
          Cancellare il rapporto gara <strong>{data.matchNumber || report.id}</strong>?
          {' '}L'operazione non può essere annullata.
        </ConfirmModal>
      ) : null}

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
          {canManageReport ? (
            <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${report.id}/edit`)}>
              Modifica
            </button>
          ) : null}
          {!isReferee ? (
            <button type="button" className="primary-button" onClick={handleExportBoth} disabled={exporting}>
              {exporting ? 'Genero PDF...' : 'Genera i 2 PDF'}
            </button>
          ) : null}
          {canManageReport ? (
            <button type="button" className="danger-button" onClick={() => setShowDeleteConfirm(true)}>
              Cancella
            </button>
          ) : null}
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
