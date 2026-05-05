import { useEffect, useRef, useState } from 'react';
import { COMMON_MATCH_CHARACTERISTICS, COMPETITIONS, EVALUATION_SECTIONS, createEmptyReport, getRefereeLabel, deriveSeason } from '../../../shared/reportTemplate.js';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { Field, TextArea, TextInput } from '../components/Field.jsx';
import EvaluationEditor from '../components/EvaluationEditor.jsx';
import SegmentedChoice from '../components/SegmentedChoice.jsx';
import Select from '../components/Select.jsx';

function observerNameForUser(user) {
  return user?.displayName || user?.username || '';
}

function instructorCompetitionsForUser(user) {
  if (user?.role !== 'instructor') return [];
  if (Array.isArray(user?.instructorCompetitions)) return user.instructorCompetitions;
  if (user?.instructorCompetition) return [user.instructorCompetition];
  if (Array.isArray(user?.formatterCompetitions)) return user.formatterCompetitions;
  return user?.formatterCompetition ? [user.formatterCompetition] : [];
}

function createInitialReport(currentUser) {
  const report = createEmptyReport();
  const instructorCompetitions = instructorCompetitionsForUser(currentUser);
  if (instructorCompetitions.length === 1) {
    report.competition = instructorCompetitions[0];
  }
  if (currentUser?.role !== 'admin') {
    report.observerName = observerNameForUser(currentUser);
  }
  return report;
}

function computeCompletion(evaluation) {
  let completed = 0;
  const total = EVALUATION_SECTIONS.length + 1; // +1 for globalJudgement
  for (const section of EVALUATION_SECTIONS) {
    const sectionData = evaluation.sections[section.id];
    const ratingsOk = section.groups.every((g) => Boolean(sectionData?.ratings?.[g.id]));
    const commentOk = !section.requiredCommentForFinal || Boolean(sectionData?.comment?.trim());
    if (ratingsOk && commentOk) completed++;
  }
  if (evaluation.globalJudgement?.trim()) completed++;
  return { completed, total };
}

function canEditReport(report, currentUser) {
  return currentUser?.role === 'admin' || report?.createdBy === currentUser?.id;
}

export default function ReportFormPage({ id, currentUser }) {
  const isEdit = Boolean(id);
  const observerLocked = currentUser?.role !== 'admin';
  const instructorCompetitions = currentUser?.role === 'instructor' ? instructorCompetitionsForUser(currentUser) : [];
  const lockedCompetition = instructorCompetitions.length === 1 ? instructorCompetitions[0] : '';
  const lockedObserverName = observerNameForUser(currentUser);
  const [report, setReport] = useState(() => createInitialReport(currentUser));
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

  // refs so effects with [] can access latest state
  const reportIdRef = useRef(id || null);
  const reportRef = useRef(report);
  const statusRef = useRef(report.status || 'draft');
  const editForbiddenRef = useRef(false);
  const observerLockedRef = useRef(observerLocked);
  const lockedObserverNameRef = useRef(lockedObserverName);
  const saveRef = useRef(null);

  useEffect(() => {
    reportRef.current = report;
    statusRef.current = report.status || 'draft';
  }, [report]);
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
    if (isEdit || !observerLocked) return;
    updateReport((current) => ({
      ...current,
      observerName: lockedObserverName,
      ...(lockedCompetition ? { competition: lockedCompetition } : {})
    }));
  }, [isEdit, observerLocked, lockedObserverName, lockedCompetition]);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    api.getReport(id)
      .then((data) => {
        if (!alive) return;
        if (!canEditReport(data.report, currentUser)) {
          setEditForbidden(true);
          setLoadError('');
          return;
        }
        setEditForbidden(false);
        setLoadError('');
        updateReport(observerLocked
          ? {
              ...data.report.data,
              observerName: lockedObserverName,
              ...(lockedCompetition ? { competition: lockedCompetition } : {})
            }
          : data.report.data);
      })
      .catch((err) => setLoadError(err.message || 'Impossibile caricare il rapporto.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, isEdit, observerLocked, lockedObserverName, lockedCompetition, currentUser]);

  // Arbitri della stagione/categoria del rapporto. La stagione deriva dalla data gara.
  useEffect(() => {
    const season = deriveSeason(report.reportDate);
    if (!season) {
      setAvailableReferees([]);
      setRefereeSuggestions([]);
      return;
    }
    api.listReferees({ season, activeOnly: true })
      .then((data) => setRefereeSuggestions(data.referees || []))
      .catch(() => setRefereeSuggestions([]));
    api.listReferees({ competition: report.competition, season, activeOnly: true })
      .then((data) => setAvailableReferees(data.referees || []))
      .catch(() => setAvailableReferees([]));
  }, [report.competition, report.reportDate]);

  // Feature 1: auto-save as draft every 60 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (editForbiddenRef.current || statusRef.current === 'final') return;
      const payload = observerLockedRef.current
        ? { ...reportRef.current, observerName: lockedObserverNameRef.current }
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
        // silent — don't distract the user with autosave errors
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [lockedCompetition]);

  // Feature 6: keyboard shortcuts — Ctrl+S = draft, Ctrl+Enter = final
  useEffect(() => {
    function handleKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') {
        e.preventDefault();
        saveRef.current?.('draft');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        saveRef.current?.('final');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function setField(field, value) {
    if (field === 'observerName' && observerLocked) return;
    updateReport((current) => ({ ...current, [field]: value }));
  }

  function setFields(updates) {
    updateReport((current) => ({ ...current, ...updates }));
  }

  function setCompetition(value) {
    if (lockedCompetition || (instructorCompetitions.length && !instructorCompetitions.includes(value))) return;
    updateReport((current) => ({
      ...current,
      competition: value,
      firstRefereeId: null,
      firstRefereeName: '',
      secondRefereeId: null,
      secondRefereeName: ''
    }));
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
        ratings: {
          ...current.matchCharacteristics.ratings,
          [groupId]: rating
        }
      }
    }));
  }

  function setMatchComment(comment) {
    updateReport((current) => ({
      ...current,
      matchCharacteristics: {
        ...current.matchCharacteristics,
        comment
      }
    }));
  }

  function setEvaluation(role, evaluation) {
    updateReport((current) => ({
      ...current,
      evaluations: {
        ...current.evaluations,
        [role]: evaluation
      }
    }));
  }

  async function save(status) {
    if (saving || editForbidden) return;
    const requestedStatus = statusRef.current === 'final' ? 'final' : status;
    setSaving(requestedStatus);
    setErrors([]);
    setMessage('');
    try {
      const currentReport = reportRef.current;
      const reportToSave = observerLocked
        ? { ...currentReport, observerName: lockedObserverName, ...(lockedCompetition ? { competition: lockedCompetition } : {}) }
        : currentReport;
      const currentId = reportIdRef.current;
      const response = currentId
        ? await api.updateReport(currentId, reportToSave, requestedStatus)
        : await api.createReport(reportToSave, requestedStatus);
      const saved = response.report;
      if (!currentId) reportIdRef.current = saved.id;
      if (saved?.data) updateReport(saved.data);
      statusRef.current = saved?.status || saved?.data?.status || requestedStatus;
      setMessage(statusRef.current === 'final' ? 'Rapporto salvato come definitivo.' : 'Bozza salvata.');
      window.setTimeout(() => navigate(`/reports/${saved.id}`), 350);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(err.details);
      } else {
        setErrors([err.message || 'Salvataggio non riuscito.']);
      }
    } finally {
      setSaving('');
    }
  }

  // keep saveRef pointing to latest save (for keyboard shortcut effect)
  useEffect(() => { saveRef.current = save; });

  // Feature 2: completion indicator per referee tab
  const completionFirst = computeCompletion(report.evaluations.first);
  const completionSecond = computeCompletion(report.evaluations.second);
  const completionFor = { first: completionFirst, second: completionSecond };

  const activeName = activeRole === 'first' ? report.firstRefereeName : report.secondRefereeName;
  const otherRole = activeRole === 'first' ? 'second' : 'first';

  // Feature 7: save actions block reused at top and bottom
  function SaveActions() {
    const isFinalReport = report.status === 'final' || statusRef.current === 'final';
    const draftButtonLabel = saving === 'draft' || (isFinalReport && saving === 'final')
      ? 'Salvo...'
      : isFinalReport ? 'Salva modifiche' : 'Salva bozza';
    return (
      <div className="save-actions">
        <button type="button" className="ghost-button" onClick={() => navigate(isEdit ? `/reports/${id}` : '/')}>
          Annulla
        </button>
        <button type="button" className="ghost-button" onClick={() => save('draft')} disabled={Boolean(saving)}>
          {draftButtonLabel}
        </button>
        <button type="button" className="primary-button" onClick={() => save('final')} disabled={Boolean(saving)}>
          {saving === 'final' ? 'Salvo...' : 'Salva definitivo'}
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="empty-state">Caricamento rapporto...</div>;
  }

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
        <button type="button" className="primary-button" onClick={() => navigate('/')}>
          Torna alla dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="form-hero">
        <div>
          <p className="eyebrow">{isEdit ? 'Modifica rapporto' : 'Nuovo rapporto'}</p>
          <h1>{report.matchNumber ? `Gara ${report.matchNumber}` : 'Compila un nuovo rapporto'}</h1>
          <p>Le bozze possono restare incomplete. Il definitivo controlla i campi essenziali prima di salvare.</p>
        </div>
        <SaveActions />
      </section>

      {autoSaveMsg ? <div className="autosave-banner">{autoSaveMsg}</div> : null}
      {message ? <div className="success-banner">{message}</div> : null}
      {errors.length ? (
        <div className="error-banner">
          <strong>Controlla questi punti:</strong>
          {errors.map((error) => <span key={error}>{error}</span>)}
        </div>
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Dati gara</h2>
            <p>Questa intestazione sarà riportata in entrambi i PDF.</p>
          </div>
        </div>
        <div className="common-grid">
          <Field label="Osservatore" className="field-span-2">
            <TextInput
              value={observerLocked ? lockedObserverName : report.observerName}
              onChange={(event) => setField('observerName', event.target.value)}
              disabled={observerLocked}
            />
          </Field>
          <Field label="Data">
            <TextInput
              type="date"
              min="1900-01-01"
              max="2050-12-31"
              value={report.reportDate}
              onChange={(event) => setField('reportDate', event.target.value)}
            />
          </Field>
          <Field label="Numero gara">
            <TextInput value={report.matchNumber} onChange={(event) => setField('matchNumber', event.target.value)} />
          </Field>
          <Field label="Campionato" className="field-span-2">
            <Select
              value={report.competition}
              onChange={setCompetition}
              placeholder="— Seleziona —"
              options={COMPETITIONS
                .filter((c) => !instructorCompetitions.length || instructorCompetitions.includes(c.value))
                .map((c) => ({ value: c.value, label: c.label }))}
              disabled={Boolean(lockedCompetition)}
            />
          </Field>
          <Field label="Squadra casa" className="field-span-2">
            <TextInput value={report.teamHome} onChange={(event) => setField('teamHome', event.target.value)} />
          </Field>
          <Field label="Squadra ospite" className="field-span-2">
            <TextInput value={report.teamAway} onChange={(event) => setField('teamAway', event.target.value)} />
          </Field>
          <Field label="Punti casa">
            <TextInput inputMode="numeric" value={report.scoreHome} onChange={(event) => setField('scoreHome', event.target.value)} />
          </Field>
          <Field label="Punti ospite">
            <TextInput inputMode="numeric" value={report.scoreAway} onChange={(event) => setField('scoreAway', event.target.value)} />
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
              onChange={(event) => setMatchComment(event.target.value)}
              placeholder="Descrivi qui complessità tecnica, clima, intensità e andamento della gara..."
            />
          </Field>
        </div>
      </section>

      <section className="tabs-card">
        {['first', 'second'].map((role) => {
          const { completed, total } = completionFor[role];
          const done = completed === total;
          return (
            <button
              type="button"
              key={role}
              className={activeRole === role ? 'is-active' : ''}
              onClick={() => setActiveRole(role)}
            >
              {getRefereeLabel(role)}
              <small>{(role === 'first' ? report.firstRefereeName : report.secondRefereeName) || 'Da compilare'}</small>
              <span className={`tab-completion${done ? ' tab-completion-done' : ''}`}>
                {done ? '✓' : `${completed}/${total}`}
              </span>
            </button>
          );
        })}
      </section>

      <EvaluationEditor
        role={activeRole}
        refereeName={activeName}
        value={report.evaluations[activeRole]}
        onChange={(evaluation) => setEvaluation(activeRole, evaluation)}
        otherRole={otherRole}
        otherEvaluation={report.evaluations[otherRole]}
        onCopyFromOther={() => setEvaluation(activeRole, report.evaluations[otherRole])}
      />

      {/* Feature 7: save buttons repeated at the bottom */}
      <div className="bottom-save">
        <p className="bottom-save-hint">Ctrl+S → bozza · Ctrl+Enter → definitivo</p>
        <SaveActions />
      </div>
    </div>
  );
}
