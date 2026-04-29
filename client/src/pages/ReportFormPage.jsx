import { useEffect, useRef, useState } from 'react';
import { COMMON_MATCH_CHARACTERISTICS, EVALUATION_SECTIONS, createEmptyReport, getRefereeLabel } from '../../../shared/reportTemplate.js';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { Field, TextArea, TextInput } from '../components/Field.jsx';
import EvaluationEditor from '../components/EvaluationEditor.jsx';
import SegmentedChoice from '../components/SegmentedChoice.jsx';

function observerNameForUser(user) {
  return user?.displayName || user?.username || '';
}

function createInitialReport(currentUser) {
  const report = createEmptyReport();
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

export default function ReportFormPage({ id, currentUser }) {
  const isEdit = Boolean(id);
  const observerLocked = currentUser?.role !== 'admin';
  const lockedObserverName = observerNameForUser(currentUser);
  const [report, setReport] = useState(() => createInitialReport(currentUser));
  const [activeRole, setActiveRole] = useState('first');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState('');
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');
  const [autoSaveMsg, setAutoSaveMsg] = useState('');
  const [refereeSuggestions, setRefereeSuggestions] = useState([]);

  // refs so effects with [] can access latest state
  const reportIdRef = useRef(id || null);
  const reportRef = useRef(report);
  const observerLockedRef = useRef(observerLocked);
  const lockedObserverNameRef = useRef(lockedObserverName);
  const saveRef = useRef(null);

  useEffect(() => { reportRef.current = report; }, [report]);
  useEffect(() => { observerLockedRef.current = observerLocked; }, [observerLocked]);
  useEffect(() => { lockedObserverNameRef.current = lockedObserverName; }, [lockedObserverName]);

  useEffect(() => {
    if (isEdit || !observerLocked) return;
    setReport((current) => ({ ...current, observerName: lockedObserverName }));
  }, [isEdit, observerLocked, lockedObserverName]);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    api.getReport(id)
      .then((data) => {
        if (alive) {
          setReport(observerLocked ? { ...data.report.data, observerName: lockedObserverName } : data.report.data);
        }
      })
      .catch((err) => setErrors([err.message || 'Impossibile caricare il rapporto.']))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, isEdit, observerLocked, lockedObserverName]);

  // Feature 5: fetch referee name suggestions once on mount
  useEffect(() => {
    api.getRefereeNames()
      .then((data) => setRefereeSuggestions(data.names || []))
      .catch(() => {});
  }, []);

  // Feature 1: auto-save as draft every 60 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const payload = observerLockedRef.current
        ? { ...reportRef.current, observerName: lockedObserverNameRef.current }
        : reportRef.current;
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
        const time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        setAutoSaveMsg(`Bozza salvata automaticamente alle ${time}`);
      } catch {
        // silent — don't distract the user with autosave errors
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

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
    setReport((current) => ({ ...current, [field]: value }));
  }

  function setMatchRating(groupId, rating) {
    setReport((current) => ({
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
    setReport((current) => ({
      ...current,
      matchCharacteristics: {
        ...current.matchCharacteristics,
        comment
      }
    }));
  }

  function setEvaluation(role, evaluation) {
    setReport((current) => ({
      ...current,
      evaluations: {
        ...current.evaluations,
        [role]: evaluation
      }
    }));
  }

  async function save(status) {
    if (saving) return;
    setSaving(status);
    setErrors([]);
    setMessage('');
    try {
      const reportToSave = observerLocked ? { ...report, observerName: lockedObserverName } : report;
      const currentId = reportIdRef.current;
      const response = currentId
        ? await api.updateReport(currentId, reportToSave, status)
        : await api.createReport(reportToSave, status);
      const saved = response.report;
      if (!currentId) reportIdRef.current = saved.id;
      setMessage(status === 'final' ? 'Rapporto salvato come definitivo.' : 'Bozza salvata.');
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
    return (
      <div className="save-actions">
        <button type="button" className="ghost-button" onClick={() => navigate(isEdit ? `/reports/${id}` : '/')}>
          Annulla
        </button>
        <button type="button" className="ghost-button" onClick={() => save('draft')} disabled={Boolean(saving)}>
          {saving === 'draft' ? 'Salvo...' : 'Salva bozza'}
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

      {/* Feature 5: datalist for referee name autocomplete */}
      <datalist id="referee-names-list">
        {refereeSuggestions.map((name) => <option key={name} value={name} />)}
      </datalist>

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
            <TextInput type="date" value={report.reportDate} onChange={(event) => setField('reportDate', event.target.value)} />
          </Field>
          <Field label="Numero gara">
            <TextInput value={report.matchNumber} onChange={(event) => setField('matchNumber', event.target.value)} />
          </Field>
          <Field label="Campionato" className="field-span-2">
            <TextInput value={report.competition} onChange={(event) => setField('competition', event.target.value)} />
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
            <TextInput
              value={report.firstRefereeName}
              list="referee-names-list"
              onChange={(event) => setField('firstRefereeName', event.target.value)}
            />
          </Field>
          <Field label="2° arbitro" className="field-span-3">
            <TextInput
              value={report.secondRefereeName}
              list="referee-names-list"
              onChange={(event) => setField('secondRefereeName', event.target.value)}
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
