import { useEffect, useRef, useState } from 'react';
import { COMMON_MATCH_CHARACTERISTICS, COMPETITIONS, EVALUATION_SECTIONS, createEmptyReport, getRefereeLabel, deriveSeason, currentSportSeason } from '../../../shared/reportTemplate.js';
import { instructorCompetitionsForSeason } from '../../../shared/instructorAssignments.js';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { Field, TextArea, TextInput } from '../components/Field.jsx';
import EvaluationEditor from '../components/EvaluationEditor.jsx';
import SegmentedChoice from '../components/SegmentedChoice.jsx';
import Select from '../components/Select.jsx';
import FormProgressNav from '../components/FormProgressNav.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { formatMatchNumber } from '../lib/formatters.js';

function observerNameForUser(user) {
  return user?.displayName || user?.username || '';
}

function createInitialReport(currentUser, season) {
  const report = createEmptyReport();
  const instructorCompetitions = instructorCompetitionsForSeason(currentUser, season);
  if (instructorCompetitions.length === 1) {
    report.competition = instructorCompetitions[0];
  }
  if (currentUser?.role !== 'admin') {
    report.observerName = observerNameForUser(currentUser);
    report.observerUserId = currentUser?.id || null;
  }
  return report;
}

function computeCompletion(evaluation) {
  let completed = 0;
  const total = EVALUATION_SECTIONS.length + 1;
  for (const section of EVALUATION_SECTIONS) {
    const sectionData = evaluation.sections[section.id];
    const ratingsOk = section.groups.every((g) => Boolean(sectionData?.ratings?.[g.id]));
    const commentOk = !section.requiredCommentForFinal || Boolean(sectionData?.comment?.trim());
    if (ratingsOk && commentOk) completed++;
  }
  if (evaluation.globalJudgement?.trim()) completed++;
  return { completed, total };
}

function computeSectionProgress(report) {
  const dataFields = ['reportDate', 'matchNumber', 'competition', 'teamHome', 'teamAway', 'scoreHome', 'scoreAway', 'observerName', 'firstRefereeName', 'secondRefereeName'];
  const dataFilled = dataFields.filter((f) => Boolean(report[f]?.toString().trim())).length;

  const commonFilled = Boolean(report.matchCharacteristics?.ratings?.difficulty) ? 1 : 0;
  const commonTotal = 1;

  const first = computeCompletion(report.evaluations.first);
  const second = computeCompletion(report.evaluations.second);

  const votesFilled = [report.evaluations.first.vote, report.evaluations.second.vote].filter(Boolean).length;

  const totalAll = dataFields.length + commonTotal + first.total + second.total + 2;
  const completedAll = dataFilled + commonFilled + first.completed + second.completed + votesFilled;

  return {
    data:    { completed: dataFilled,   total: dataFields.length },
    common:  { completed: commonFilled, total: commonTotal },
    first,
    second,
    closing: { completed: votesFilled,  total: 2 },
    overall: { completed: completedAll, total: totalAll }
  };
}

function canEditReport(report, currentUser) {
  return currentUser?.role === 'admin' ||
    report?.createdBy === currentUser?.id ||
    (report?.observerId && report.observerId === currentUser?.id);
}

export default function ReportFormPage({ id, currentUser, features, gameId, season }) {
  const isEdit = Boolean(id);
  const canChooseObserver = currentUser?.role === 'admin' || currentUser?.role === 'instructor';
  const observerLocked = !canChooseObserver;
  const lockedObserverName = observerNameForUser(currentUser);
  const [report, setReport] = useState(() => createInitialReport(currentUser, season));
  const reportSeason = deriveSeason(report.reportDate) || season || currentSportSeason();
  const instructorCompetitions = currentUser?.role === 'instructor'
    ? instructorCompetitionsForSeason(currentUser, reportSeason)
    : [];
  const lockedCompetition = instructorCompetitions.length === 1 ? instructorCompetitions[0] : '';
  const [activeRole, setActiveRole] = useState(() => {
    if (!id) return 'first';
    const storedRole = sessionStorage.getItem(`report-edit-role-${id}`);
    sessionStorage.removeItem(`report-edit-role-${id}`);
    return storedRole === 'second' ? 'second' : 'first';
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState('');
  const [errors, setErrors] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [editForbidden, setEditForbidden] = useState(false);
  const [message, setMessage] = useState('');
  const [autoSaveMsg, setAutoSaveMsg] = useState('');
  const [refereeSuggestions, setRefereeSuggestions] = useState([]);
  const [availableReferees, setAvailableReferees] = useState([]);
  const [availableObservers, setAvailableObservers] = useState([]);
  const [activeSection, setActiveSection] = useState('section-data');
  const [gameInfo, setGameInfo] = useState(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState(null);

  const reportIdRef = useRef(id || null);
  const reportRef = useRef(report);
  const statusRef = useRef(report.status || 'draft');
  const editForbiddenRef = useRef(false);
  const observerLockedRef = useRef(observerLocked);
  const lockedObserverNameRef = useRef(lockedObserverName);
  const saveRef = useRef(null);

  useEffect(() => { reportRef.current = report; statusRef.current = report.status || 'draft'; }, [report]);
  useEffect(() => { editForbiddenRef.current = editForbidden; }, [editForbidden]);
  useEffect(() => { observerLockedRef.current = observerLocked; }, [observerLocked]);
  useEffect(() => { lockedObserverNameRef.current = lockedObserverName; }, [lockedObserverName]);

  function updateReport(updater) {
    setReport((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      reportRef.current = next;
      statusRef.current = next.status || 'draft';
      return next;
    });
  }

  useEffect(() => {
    if (!observerLocked) return;
    updateReport((current) => ({
      ...current,
      observerName: lockedObserverName,
      observerUserId: currentUser?.id || null,
      ...(lockedCompetition ? { competition: lockedCompetition } : {})
    }));
  }, [observerLocked, lockedObserverName, lockedCompetition, currentUser?.id]);

  useEffect(() => {
    if (!canChooseObserver) {
      setAvailableObservers([]);
      return;
    }
    api.listGameObservers()
      .then((data) => setAvailableObservers(data.observers || []))
      .catch(() => setAvailableObservers([]));
  }, [canChooseObserver]);

  // Precompilazione da gara (pulsante "Compila rapporto" nel dettaglio gara).
  useEffect(() => {
    if (isEdit || !gameId) return;
    let alive = true;
    api.getGameReportPrefill(gameId)
      .then((data) => {
        if (!alive) return;
        const prefill = data.prefill;
        setGameInfo(prefill);
        updateReport((current) => ({
          ...current,
          gameId: prefill.gameId,
          observerUserId: observerLocked ? (currentUser?.id || null) : (prefill.observerUserId || null),
          reportDate: prefill.reportDate || current.reportDate,
          matchNumber: prefill.matchNumber || current.matchNumber,
          competition: prefill.competition || current.competition,
          teamHome: prefill.teamHome || current.teamHome,
          teamAway: prefill.teamAway || current.teamAway,
          scoreHome: prefill.scoreHome || current.scoreHome,
          scoreAway: prefill.scoreAway || current.scoreAway,
          firstRefereeId: prefill.firstRefereeId || current.firstRefereeId,
          firstRefereeName: prefill.firstRefereeName || current.firstRefereeName,
          secondRefereeId: prefill.secondRefereeId || current.secondRefereeId,
          secondRefereeName: prefill.secondRefereeName || current.secondRefereeName,
          ...(observerLocked
            ? { observerName: lockedObserverName }
            : { observerName: prefill.observerName || current.observerName })
        }));
      })
      .catch(() => setGameInfo(null));
    return () => { alive = false; };
  }, [isEdit, gameId, observerLocked, currentUser?.id, lockedObserverName]);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    api.getReport(id)
      .then((data) => {
        if (!alive) return;
        if (!canEditReport(data.report, currentUser)) {
          setEditForbidden(true);
          return;
        }
        setEditForbidden(false);
        setLoadError('');
        updateReport(observerLocked
          ? { ...data.report.data, observerName: lockedObserverName }
          : data.report.data);
      })
      .catch((err) => setLoadError(err.message || 'Impossibile caricare il rapporto.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id, isEdit, observerLocked, lockedObserverName, currentUser]);

  useEffect(() => {
    const season = deriveSeason(report.reportDate);
    if (!season) { setAvailableReferees([]); setRefereeSuggestions([]); return; }
    api.listReferees({ season, activeOnly: true })
      .then((data) => setRefereeSuggestions(data.referees || []))
      .catch(() => setRefereeSuggestions([]));
    api.listReferees({ competition: report.competition, season, activeOnly: true })
      .then((data) => setAvailableReferees(data.referees || []))
      .catch(() => setAvailableReferees([]));
  }, [report.competition, report.reportDate]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (editForbiddenRef.current || statusRef.current === 'final') return;
      const payload = observerLockedRef.current
        ? {
            ...reportRef.current,
            observerName: lockedObserverNameRef.current,
            observerUserId: currentUser?.id || null
          }
        : { ...reportRef.current };
      if (lockedCompetition) payload.competition = lockedCompetition;
      try {
        let saved;
        if (reportIdRef.current) {
          const response = await api.updateReport(reportIdRef.current, payload, 'draft');
          saved = response.report;
        } else {
          const response = await api.createReport(payload, 'draft');
          saved = response.report;
          reportIdRef.current = saved.id;
          window.history.replaceState(null, '', `#/reports/${saved.id}/edit`);
        }
        statusRef.current = saved?.status || saved?.data?.status || 'draft';
        const time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        setAutoSaveMsg(`Bozza salvata automaticamente alle ${time}`);
      } catch {
        // silent
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [lockedCompetition, currentUser?.id]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') { e.preventDefault(); saveRef.current?.(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // IntersectionObserver per active section in sidebar
  useEffect(() => {
    const sectionIds = ['section-data', 'section-common', 'section-first', 'section-closing'];
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -65% 0px', threshold: 0 }
    );
    sectionIds.forEach((sid) => {
      const el = document.getElementById(sid);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [loading]);

  function setField(field, value) {
    if (field === 'observerName' && observerLocked) return;
    updateReport((current) => ({ ...current, [field]: value }));
  }

  function setFields(updates) {
    updateReport((current) => ({ ...current, ...updates }));
  }

  function setCompetition(value) {
    if (lockedCompetition || (currentUser?.role === 'instructor' && !instructorCompetitions.includes(value))) return;
    updateReport((current) => ({
      ...current,
      competition: value,
      firstRefereeId: null,
      firstRefereeName: '',
      secondRefereeId: null,
      secondRefereeName: ''
    }));
  }

  function selectObserver(value) {
    const observerUserId = value ? Number(value) : null;
    const observer = availableObservers.find((item) => item.id === observerUserId);
    setFields({
      observerUserId,
      observerName: observer?.displayName || ''
    });
  }

  function selectReferee(role, value) {
    const refereeId = value ? Number(value) : null;
    const referee = [...availableReferees, ...refereeSuggestions].find((r) => r.id === refereeId);
    setFields({
      [`${role}RefereeId`]: refereeId,
      [`${role}RefereeName`]: referee?.fullName || ''
    });
  }

  function setMatchRating(groupId, rating) {
    updateReport((current) => ({
      ...current,
      matchCharacteristics: {
        ...current.matchCharacteristics,
        ratings: { ...current.matchCharacteristics.ratings, [groupId]: rating }
      }
    }));
  }

  function setMatchComment(comment) {
    updateReport((current) => ({
      ...current,
      matchCharacteristics: { ...current.matchCharacteristics, comment }
    }));
  }

  function setEvaluation(role, evaluation) {
    updateReport((current) => ({
      ...current,
      evaluations: { ...current.evaluations, [role]: evaluation }
    }));
  }

  async function save(explicitStatus, { allowDuplicate = false } = {}) {
    if (saving || editForbidden) return;
    const isComplete = computeSectionProgress(reportRef.current).overall.completed === computeSectionProgress(reportRef.current).overall.total;
    const requestedStatus = statusRef.current === 'final'
      ? 'final'
      : (explicitStatus ?? (isComplete ? 'final' : 'draft'));
    setSaving(requestedStatus);
    setErrors([]);
    setMessage('');
    try {
      const currentReport = reportRef.current;
      const reportToSave = observerLocked
        ? {
            ...currentReport,
            observerName: lockedObserverName,
            observerUserId: currentUser?.id || null,
            ...(lockedCompetition ? { competition: lockedCompetition } : {})
          }
        : currentReport;
      const currentId = reportIdRef.current;
      const response = currentId
        ? await api.updateReport(currentId, reportToSave, requestedStatus)
        : await api.createReport(reportToSave, requestedStatus, { allowDuplicate });
      const saved = response.report;
      if (!currentId) reportIdRef.current = saved.id;
      if (saved?.data) updateReport(saved.data);
      statusRef.current = saved?.status || saved?.data?.status || requestedStatus;
      setMessage(statusRef.current === 'final' ? 'Rapporto salvato come definitivo.' : 'Bozza salvata.');
      window.setTimeout(() => navigate(`/reports/${saved.id}`), 350);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.requiresConfirmation) {
        setDuplicateConfirm({ status: requestedStatus, existingReportId: err.details.existingReportId });
      } else if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(err.details);
      } else {
        setErrors([err.message || 'Salvataggio non riuscito.']);
      }
    } finally {
      setSaving('');
    }
  }

  useEffect(() => { saveRef.current = save; });

  const completionFirst = computeCompletion(report.evaluations.first);
  const completionSecond = computeCompletion(report.evaluations.second);
  const completionFor = { first: completionFirst, second: completionSecond };
  const progress = computeSectionProgress(report);
  const isFullyComplete = progress.overall.completed === progress.overall.total;

  const activeName = activeRole === 'first' ? report.firstRefereeName : report.secondRefereeName;
  const otherRole = activeRole === 'first' ? 'second' : 'first';

  function SaveActions() {
    const saveLabel = saving
      ? 'Salvo…'
      : isFullyComplete ? 'Salva definitivo' : 'Salva bozza';
    return (
      <div className="save-actions">
        <button
          type="button"
          className="ghost-button"
          onClick={() => navigate(isEdit ? `/reports/${id}` : gameId ? `/games/${gameId}` : '/reports')}
        >
          Annulla
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => save()}
          disabled={Boolean(saving)}
        >
          {saveLabel}
        </button>
      </div>
    );
  }

  if (loading) return <div className="empty-state">Caricamento rapporto…</div>;

  if (editForbidden) {
    return (
      <div className="empty-state">
        <h2>Modifica non consentita</h2>
        <p>Puoi consultare questo rapporto, ma solo chi lo ha creato o un admin può modificarlo.</p>
        <button type="button" className="primary-button" onClick={() => navigate(`/reports/${id}`)}>
          Torna al rapporto
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="empty-state">
        <h2>Rapporto non modificabile</h2>
        <p>{loadError}</p>
        <button type="button" className="primary-button" onClick={() => navigate('/reports')}>
          Torna ai rapporti
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Hero sticky */}
      <section className="form-hero" style={{ marginBottom: 20 }}>
        <div>
          <p className="eyebrow">{isEdit ? 'Modifica rapporto' : 'Nuovo rapporto'}</p>
          <h1>{report.matchNumber ? `Gara ${formatMatchNumber(report.matchNumber)}` : 'Compila un nuovo rapporto'}</h1>
        </div>
        <SaveActions />
      </section>

      {autoSaveMsg ? <div className="autosave-banner" style={{ marginBottom: 16 }}>{autoSaveMsg}</div> : null}
      {message ? <div className="success-banner" style={{ marginBottom: 16 }}>{message}</div> : null}
      {gameInfo?.existingReportId && !isEdit ? (
        <div className="error-banner" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>
            <strong>Attenzione:</strong> esiste già un rapporto per la gara {formatMatchNumber(gameInfo.matchNumber)}.
          </span>
          <button type="button" className="ghost-button" onClick={() => navigate(`/reports/${gameInfo.existingReportId}`)}>
            Apri il rapporto esistente
          </button>
        </div>
      ) : null}
      {errors.length ? (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          <strong>Controlla questi punti:</strong>
          {errors.map((e) => <span key={e}>{e}</span>)}
        </div>
      ) : null}

      <div className="form-shell">
        {/* Sidebar progress */}
        <FormProgressNav
          progress={progress}
          activeSection={activeSection}
          activeRole={activeRole}
          refereeNames={{ first: report.firstRefereeName, second: report.secondRefereeName }}
          onNavigate={(sectionId, role) => {
            if (role) setActiveRole(role);
            const el = document.getElementById(sectionId);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveSection(sectionId);
          }}
        />

        {/* Form principale */}
        <div className="page-stack">
          {/* Sezione: Dati gara */}
          <section id="section-data" className="common-card form-section">
            <div className="section-heading">
              <div>
                <h2>Dati gara</h2>
                <p>Questa intestazione sarà riportata in entrambi i PDF.</p>
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
                  onChange={setCompetition}
                  placeholder="— Seleziona —"
                  options={COMPETITIONS
                    .filter((c) => currentUser?.role !== 'instructor' || instructorCompetitions.includes(c.value))
                    .map((c) => ({ value: c.value, label: c.label }))}
                  disabled={Boolean(lockedCompetition)}
                />
              </Field>
              <Field label="Squadra casa" className="field-span-2">
                <TextInput value={report.teamHome} onChange={(e) => setField('teamHome', e.target.value)} />
              </Field>
              <Field label="Squadra ospite" className="field-span-2">
                <TextInput value={report.teamAway} onChange={(e) => setField('teamAway', e.target.value)} />
              </Field>
              <Field label="Punti casa">
                <TextInput inputMode="numeric" value={report.scoreHome} onChange={(e) => setField('scoreHome', e.target.value)} />
              </Field>
              <Field label="Punti ospite">
                <TextInput inputMode="numeric" value={report.scoreAway} onChange={(e) => setField('scoreAway', e.target.value)} />
              </Field>
              <Field label="1° arbitro" className="field-span-3">
                <Select
                  value={report.firstRefereeId ? String(report.firstRefereeId) : ''}
                  onChange={(v) => selectReferee('first', v)}
                  placeholder="— Seleziona arbitro —"
                  options={[
                    ...availableReferees.map((r) => ({ value: String(r.id), label: r.fullName })),
                    report.firstRefereeId && !availableReferees.some((r) => r.id === report.firstRefereeId)
                      ? { value: String(report.firstRefereeId), label: report.firstRefereeName || 'Arbitro selezionato' }
                      : null
                  ].filter(Boolean)}
                  searchable
                />
              </Field>
              <Field label="2° arbitro" className="field-span-3">
                <Select
                  value={report.secondRefereeId ? String(report.secondRefereeId) : ''}
                  onChange={(v) => selectReferee('second', v)}
                  placeholder="— Seleziona arbitro —"
                  options={[
                    ...availableReferees.map((r) => ({ value: String(r.id), label: r.fullName })),
                    report.secondRefereeId && !availableReferees.some((r) => r.id === report.secondRefereeId)
                      ? { value: String(report.secondRefereeId), label: report.secondRefereeName || 'Arbitro selezionato' }
                      : null
                  ].filter(Boolean)}
                  searchable
                />
              </Field>
            </div>
          </section>

          {/* Sezione: Caratteristiche gara */}
          <section id="section-common" className="common-card form-section">
            <div className="common-match-card">
              <div className="section-heading">
                <div>
                  <h3>{COMMON_MATCH_CHARACTERISTICS.title}</h3>
                  <p>{COMMON_MATCH_CHARACTERISTICS.description}</p>
                </div>
                <span className="shared-pill">Comune ai due arbitri</span>
              </div>
              <div className="rating-grid">
                {COMMON_MATCH_CHARACTERISTICS.groups.map((group) => (
                  <SegmentedChoice
                    key={group.id}
                    label={group.label}
                    options={group.options}
                    value={report.matchCharacteristics.ratings[group.id]}
                    onChange={(rating) => setMatchRating(group.id, rating)}
                  />
                ))}
              </div>
              <Field label={COMMON_MATCH_CHARACTERISTICS.commentLabel}>
                <TextArea
                  value={report.matchCharacteristics.comment}
                  onChange={(e) => setMatchComment(e.target.value)}
                  placeholder="Descrivi qui complessità tecnica, clima, intensità e andamento della gara…"
                />
              </Field>
            </div>
          </section>

          {/* Ancora per scroll sidebar */}
          <div id="section-first" className="form-section" style={{ height: 0, overflow: 'hidden' }} />

          <EvaluationEditor
            role={activeRole}
            refereeName={activeName}
            value={report.evaluations[activeRole]}
            onChange={(evaluation) => setEvaluation(activeRole, evaluation)}
            otherRole={otherRole}
            otherEvaluation={report.evaluations[otherRole]}
            onCopyFromOther={() => setEvaluation(activeRole, report.evaluations[otherRole])}
            report={report}
            aiEnabled={Boolean(features?.aiEnabled)}
          />

          {/* Ancora per sezione voti */}
          <div id="section-closing" className="form-section" style={{ height: 0, overflow: 'hidden' }} />

          <div className="bottom-save">
            <p className="bottom-save-hint">Ctrl+S → salva</p>
            <SaveActions />
          </div>
        </div>
      </div>

      {duplicateConfirm ? (
        <ConfirmModal
          title="Rapporto già esistente per questa gara"
          confirmLabel="Crea comunque un secondo rapporto"
          onConfirm={() => {
            const status = duplicateConfirm.status;
            setDuplicateConfirm(null);
            save(status, { allowDuplicate: true });
          }}
          onCancel={() => setDuplicateConfirm(null)}
        >
          Per questa gara esiste già un rapporto. Di norma non serve crearne un secondo: puoi aprire
          quello esistente dal dettaglio della gara. Confermi di volerne creare un altro?
        </ConfirmModal>
      ) : null}
    </div>
  );
}
