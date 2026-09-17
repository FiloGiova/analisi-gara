import { useEffect, useRef, useState } from 'react';
import {
  VIDEO_JUDGMENT_OPTIONS,
  createEmptyVideoReport,
  deriveSeason,
  currentSportSeason
} from '../../../shared/reportTemplate.js';
import { instructorCompetitionsForSeason } from '../../../shared/instructorAssignments.js';
import { api, ApiError, downloadReportAttachment } from '../lib/api.js';
import { useCompetitions } from '../lib/competitions.jsx';
import { navigate } from '../lib/navigation.js';
import { Field, TextArea, TextInput } from '../components/Field.jsx';
import SegmentedChoice from '../components/SegmentedChoice.jsx';
import Select from '../components/Select.jsx';
import ReportTypeBadge from '../components/ReportTypeBadge.jsx';
import AttachmentCard from '../components/AttachmentCard.jsx';
import { formatMatchNumber } from '../lib/formatters.js';

// Rapporto a video: una sola schermata corta. Niente sezioni di valutazione,
// niente voto, niente PDF: un giudizio per arbitro più il referto allegato.

function observerNameForUser(user) {
  return user?.displayName || user?.username || '';
}

function initialReport(currentUser, season) {
  const report = createEmptyVideoReport();
  const instructorCompetitions = instructorCompetitionsForSeason(currentUser, season);
  if (instructorCompetitions.length === 1) report.competition = instructorCompetitions[0];
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'instructor') {
    report.observerName = observerNameForUser(currentUser);
    report.observerUserId = currentUser?.id || null;
  }
  return report;
}

function canEditReport(report, currentUser) {
  return currentUser?.role === 'admin' ||
    report?.createdBy === currentUser?.id ||
    (report?.observerId && report.observerId === currentUser?.id);
}

export default function ReportVideoFormPage({ id, currentUser, gameId, season }) {
  const { activeCompetitions, competitionLabel } = useCompetitions();
  const isEdit = Boolean(id);
  const canChooseObserver = currentUser?.role === 'admin' || currentUser?.role === 'instructor';
  const observerLocked = !canChooseObserver;
  const lockedObserverName = observerNameForUser(currentUser);

  const [report, setReport] = useState(() => initialReport(currentUser, season));
  const [reportId, setReportId] = useState(id || null);
  const [status, setStatus] = useState('draft');
  const [attachment, setAttachment] = useState(null);
  // File scelto prima del primo salvataggio: si carica appena il rapporto esiste.
  const pendingFileRef = useRef(null);
  const [pendingFileName, setPendingFileName] = useState('');
  const [availableObservers, setAvailableObservers] = useState([]);
  const [availableReferees, setAvailableReferees] = useState([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reportSeason = deriveSeason(report.reportDate) || season || currentSportSeason();
  const instructorCompetitions = currentUser?.role === 'instructor'
    ? instructorCompetitionsForSeason(currentUser, reportSeason)
    : [];
  const lockedCompetition = instructorCompetitions.length === 1 ? instructorCompetitions[0] : '';
  // Come nel rapporto completo, un definitivo resta modificabile da chi vi ha
  // accesso: salvando resta definitivo, non torna in bozza.
  const isFinal = status === 'final';

  function setField(field, value) {
    setReport((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    if (!canChooseObserver) return;
    api.listGameObservers()
      .then((data) => setAvailableObservers(data.observers || []))
      .catch(() => setAvailableObservers([]));
  }, [canChooseObserver]);

  useEffect(() => {
    if (!reportSeason) return;
    api.listReferees({ competition: report.competition, season: reportSeason, activeOnly: true })
      .then((data) => setAvailableReferees(data.referees || []))
      .catch(() => setAvailableReferees([]));
  }, [report.competition, reportSeason]);

  // Precompilazione dalla gara (pulsante "Rapporto a video" nel dettaglio gara).
  useEffect(() => {
    if (isEdit || !gameId) return;
    let alive = true;
    api.getGameReportPrefill(gameId)
      .then((data) => {
        if (!alive) return;
        const prefill = data.prefill;
        setReport((current) => ({
          ...current,
          gameId: prefill.gameId,
          observerUserId: observerLocked ? (currentUser?.id || null) : (prefill.observerUserId || null),
          observerName: observerLocked ? lockedObserverName : (prefill.observerName || current.observerName),
          reportDate: prefill.reportDate || current.reportDate,
          matchNumber: prefill.matchNumber || current.matchNumber,
          competition: prefill.competition || current.competition,
          teamHome: prefill.teamHome || current.teamHome,
          teamAway: prefill.teamAway || current.teamAway,
          firstRefereeId: prefill.firstRefereeId || current.firstRefereeId,
          firstRefereeName: prefill.firstRefereeName || current.firstRefereeName,
          secondRefereeId: prefill.secondRefereeId || current.secondRefereeId,
          secondRefereeName: prefill.secondRefereeName || current.secondRefereeName
        }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isEdit, gameId, observerLocked, currentUser?.id, lockedObserverName]);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    api.getReport(id)
      .then((data) => {
        if (!alive) return;
        if (data.report.reportType !== 'video') {
          navigate(`/reports/${id}/edit`);
          return;
        }
        if (!canEditReport(data.report, currentUser)) {
          setError('Puoi modificare solo i rapporti di cui sei l’osservatore designato.');
          return;
        }
        setReport(data.report.data);
        setStatus(data.report.status);
        setAttachment(data.report.attachment || null);
      })
      .catch((err) => setError(err.message || 'Impossibile caricare il rapporto.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id, isEdit, currentUser]);

  function selectReferee(role, value) {
    const referee = availableReferees.find((item) => String(item.id) === value);
    setReport((current) => ({
      ...current,
      [`${role}RefereeId`]: referee ? referee.id : null,
      [`${role}RefereeName`]: referee ? referee.fullName : ''
    }));
  }

  function selectObserver(value) {
    const observer = availableObservers.find((item) => String(item.id) === value);
    setReport((current) => ({
      ...current,
      observerUserId: observer ? observer.id : null,
      observerName: observer ? observer.displayName : ''
    }));
  }

  function payloadToSave() {
    const payload = { ...report, reportType: 'video' };
    if (observerLocked) {
      payload.observerName = lockedObserverName;
      payload.observerUserId = currentUser?.id || null;
    }
    if (lockedCompetition) payload.competition = lockedCompetition;
    return payload;
  }

  async function save(nextStatus) {
    setBusy(true);
    setErrors([]);
    setError('');
    setMessage('');
    try {
      const payload = payloadToSave();
      let saved;
      if (reportId) {
        saved = (await api.updateReport(reportId, payload, nextStatus)).report;
      } else {
        saved = (await api.createReport(payload, nextStatus)).report;
        setReportId(saved.id);
      }
      setStatus(saved.status);

      // L'allegato scelto prima di avere un id parte adesso.
      if (pendingFileRef.current) {
        const uploaded = await api.uploadReportAttachment(saved.id, pendingFileRef.current);
        pendingFileRef.current = null;
        setPendingFileName('');
        setAttachment(uploaded.report?.attachment || null);
      } else {
        setAttachment(saved.attachment || null);
      }

      setMessage(nextStatus === 'final' ? 'Rapporto a video reso definitivo.' : 'Bozza salvata.');
      if (nextStatus === 'final') navigate(`/reports/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details) && err.details.length) {
        setErrors(err.details);
      } else {
        setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachmentSelected(file) {
    setError('');
    if (!reportId) {
      pendingFileRef.current = file;
      setPendingFileName(file.name);
      setMessage('L’allegato verrà caricato al primo salvataggio.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.uploadReportAttachment(reportId, file);
      setAttachment(data.report?.attachment || null);
      setMessage('Allegato caricato.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Caricamento non riuscito.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachmentDelete() {
    if (!reportId) {
      pendingFileRef.current = null;
      setPendingFileName('');
      return;
    }
    setBusy(true);
    try {
      const data = await api.deleteReportAttachment(reportId);
      setAttachment(data.report?.attachment || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eliminazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  if (currentUser?.role === 'referee') {
    return <div className="empty-state"><h2>Sezione non disponibile</h2></div>;
  }

  if (loading) {
    return <div className="empty-state"><h2>Caricamento…</h2></div>;
  }

  return (
    <div className="page-stack">
      <section className="form-hero">
        <div>
          <p className="eyebrow">
            {isEdit ? 'Modifica rapporto' : 'Nuovo rapporto'} <ReportTypeBadge type="video" />
          </p>
          <h1>{report.matchNumber ? `Gara ${formatMatchNumber(report.matchNumber)}` : 'Rapporto a video'}</h1>
          <p>
            Visionatura da video: conta come rapporto nelle statistiche dell’arbitro, ma non produce
            un voto né un PDF.
          </p>
        </div>
        <div className="hero-actions">
          {!isFinal ? (
            <button type="button" className="ghost-button" onClick={() => save('draft')} disabled={busy}>
              Salva bozza
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={() => save('final')} disabled={busy}>
            {isFinal ? 'Salva' : 'Rendi definitivo'}
          </button>
        </div>
      </section>

      {isFinal ? (
        <div className="success-banner">
          Rapporto definitivo: conta già come visionatura. Le modifiche restano definitive.
        </div>
      ) : null}
      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {errors.length ? (
        <div className="error-banner">
          <strong>Controlla questi punti:</strong>
          {errors.map((item) => <span key={item}>{item}</span>)}
        </div>
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Dati gara</h2>
            <p>Servono a collegare la visionatura all’arbitro e alla stagione.</p>
          </div>
        </div>
        <div className="common-grid">
          <Field label="Osservatore" className="field-span-2">
            {observerLocked ? (
              <TextInput value={lockedObserverName} disabled />
            ) : (
              <Select
                value={report.observerUserId ? String(report.observerUserId) : ''}
                onChange={selectObserver}
                placeholder="— Seleziona osservatore —"
                options={[
                  ...availableObservers.map((observer) => ({
                    value: String(observer.id),
                    label: `${observer.displayName} · ${observer.role === 'instructor' ? 'Formatore' : 'Osservatore'}`
                  })),
                  report.observerUserId && !availableObservers.some((observer) => observer.id === report.observerUserId)
                    ? { value: String(report.observerUserId), label: report.observerName || 'Utente selezionato' }
                    : null
                ].filter(Boolean)}
                searchable
               
              />
            )}
          </Field>
          <Field label="Data">
            <TextInput
              type="date"
              min="1900-01-01"
              max="2050-12-31"
              value={report.reportDate}
              onChange={(e) => setField('reportDate', e.target.value)}
             
            />
          </Field>
          <Field label="Numero gara">
            <TextInput value={report.matchNumber} onChange={(e) => setField('matchNumber', e.target.value)} />
          </Field>
          <Field label="Campionato" className="field-span-2">
            <Select
              value={report.competition}
              onChange={(value) => setField('competition', value)}
              placeholder="— Seleziona —"
              options={[
                ...activeCompetitions
                  .filter((item) => currentUser?.role !== 'instructor' || instructorCompetitions.includes(item.value))
                  .map((item) => ({ value: item.value, label: item.label })),
                ...(report.competition && !activeCompetitions.some((item) => item.value === report.competition)
                  ? [{ value: report.competition, label: competitionLabel(report.competition) }]
                  : [])
              ]}
              disabled={Boolean(lockedCompetition)}
            />
          </Field>
          <Field label="Squadra casa" className="field-span-2">
            <TextInput value={report.teamHome} onChange={(e) => setField('teamHome', e.target.value)} />
          </Field>
          <Field label="Squadra ospite" className="field-span-2">
            <TextInput value={report.teamAway} onChange={(e) => setField('teamAway', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Giudizio</h2>
            <p>Una valutazione sintetica per arbitro: è ciò che resta nello storico.</p>
          </div>
        </div>
        <div className="page-stack">
          {['first', 'second'].map((role) => (
            <div key={role} className="video-judgement-card">
              <h3>{role === 'first' ? '1° arbitro' : '2° arbitro'}</h3>
              <Select
                value={report[`${role}RefereeId`] ? String(report[`${role}RefereeId`]) : ''}
                onChange={(value) => selectReferee(role, value)}
                placeholder="— Seleziona arbitro —"
                options={[
                  ...availableReferees.map((item) => ({ value: String(item.id), label: item.fullName })),
                  report[`${role}RefereeId`] && !availableReferees.some((item) => item.id === report[`${role}RefereeId`])
                    ? { value: String(report[`${role}RefereeId`]), label: report[`${role}RefereeName`] || 'Arbitro selezionato' }
                    : null
                ].filter(Boolean)}
                searchable
               
              />
              <SegmentedChoice
                options={VIDEO_JUDGMENT_OPTIONS}
                value={report.judgements?.[role] || ''}
                onChange={(value) => setReport((current) => ({
                  ...current,
                  judgements: { ...current.judgements, [role]: value }
                }))}
              />
            </div>
          ))}

          <Field label="Note (facoltative)">
            <TextArea
              value={report.notes}
              onChange={(e) => setField('notes', e.target.value)}
             
              placeholder="Osservazioni sulla visionatura"
            />
          </Field>
        </div>
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Allegato</h2>
            <p>Il referto della visionatura, in PDF o XLSX (max 10 MB). Resta scaricabile dal rapporto e dalla gara.</p>
          </div>
        </div>
        <AttachmentCard
          attachment={attachment}
          pendingFileName={pendingFileName}
          disabled={busy}
          onSelect={handleAttachmentSelected}
          onDelete={handleAttachmentDelete}
          onDownload={reportId ? () => downloadReportAttachment(reportId) : null}
        />
      </section>
    </div>
  );
}
