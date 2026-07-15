import { createPortal } from 'react-dom';
import { useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import Select from './Select.jsx';

const ROLE_LABELS = { first: '1° arbitro', second: '2° arbitro' };
const HEADER_LABELS = {
  observerName: 'valutatore',
  reportDate: 'data gara',
  competition: 'campionato',
  teamHome: 'squadra casa',
  teamAway: 'squadra ospite',
  scoreHome: 'punteggio casa',
  scoreAway: 'punteggio ospite',
  firstRefereeName: '1° arbitro',
  secondRefereeName: '2° arbitro',
  matchCharacteristics: 'caratteristiche gara'
};

function gameLabel(game) {
  const date = game.scheduledAt ? new Date(game.scheduledAt).toLocaleDateString('it-IT') : 'data assente';
  return `#${game.matchNumber} · ${game.teamHome} – ${game.teamAway} · ${date}`;
}

function initialDecision(group) {
  const game = group.gameCandidates.find((item) => item.id === group.automaticGameId) || null;
  const reports = game?.reportCandidates || group.reportCandidates || [];
  const reportId = group.automaticReportId || (reports.length === 1 ? reports[0].id : null);
  return {
    selected: group.duplicateRoles.length === 0,
    gameId: group.automaticGameId || '',
    reportId: reportId || '',
    firstRefereeId: group.people.first.refereeId || '',
    secondRefereeId: group.people.second.refereeId || '',
    observerUserId: group.people.observer.userId || '',
    sharedSourceRole: group.requiresSharedSource ? '' : (group.presentRoles.includes('first') ? 'first' : group.presentRoles[0]),
    replaceExisting: false
  };
}

function refereeOptions(person, directory = []) {
  const values = [];
  if (person.refereeId) {
    values.push({ value: String(person.refereeId), label: person.externalName });
  }
  for (const candidate of person.candidates || []) {
    if (!values.some((item) => item.value === String(candidate.refereeId))) {
      values.push({ value: String(candidate.refereeId), label: candidate.fullName });
    }
  }
  for (const referee of directory) {
    if (!values.some((item) => item.value === String(referee.id))) {
      values.push({ value: String(referee.id), label: referee.fullName });
    }
  }
  return values;
}

function observerOptions(person, directory = []) {
  const values = [{ value: '', label: 'Non associare a un utente' }];
  if (person.userId) values.push({ value: String(person.userId), label: person.externalName });
  for (const candidate of person.candidates || []) {
    if (!values.some((item) => item.value === String(candidate.userId))) {
      values.push({ value: String(candidate.userId), label: candidate.displayName });
    }
  }
  for (const observer of directory) {
    if (!values.some((item) => item.value === String(observer.id))) {
      values.push({ value: String(observer.id), label: observer.displayName });
    }
  }
  return values;
}

function reportCandidatesFor(group, gameId) {
  return group.gameCandidates.find((game) => game.id === Number(gameId))?.reportCandidates || [];
}

function peopleFor(group, decision) {
  return group.peopleBySource?.[decision.sharedSourceRole] || group.people;
}

function designationChanges(group, decision) {
  const game = group.gameCandidates.find((item) => item.id === Number(decision.gameId));
  if (!game) return [];
  const people = peopleFor(group, decision);
  const checks = [
    { role: 'referee1', label: '1° arbitro', current: game.officials?.referee1, id: Number(decision.firstRefereeId), incoming: people.first.externalName },
    { role: 'referee2', label: '2° arbitro', current: game.officials?.referee2, id: Number(decision.secondRefereeId), incoming: people.second.externalName }
  ];
  if (decision.observerUserId) {
    checks.push({
      role: 'observer',
      label: 'osservatore',
      current: game.officials?.observer,
      id: Number(decision.observerUserId),
      incoming: people.observer.externalName,
      user: true
    });
  }
  return checks.filter((item) => {
    const currentId = item.user ? item.current?.userId : item.current?.refereeId;
    return currentId !== item.id;
  });
}

function decisionReady(group, decision) {
  if (!decision.selected) return true;
  if (group.duplicateRoles.length) return false;
  if (!decision.gameId || !decision.firstRefereeId || !decision.secondRefereeId) return false;
  if (group.requiresSharedSource && !decision.sharedSourceRole) return false;
  const reports = reportCandidatesFor(group, decision.gameId);
  if (reports.length > 1 && !decision.reportId) return false;
  if (decision.reportId && !decision.replaceExisting) return false;
  return true;
}

export default function FederationPdfImporter({ gameId = null, reportId = null, onClose, onImported }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [refereesByGroup, setRefereesByGroup] = useState({});
  const [observerDirectory, setObserverDirectory] = useState([]);

  const selectedGroups = useMemo(
    () => (preview?.groups || []).filter((group) => decisions[group.groupKey]?.selected),
    [preview, decisions]
  );

  function setDecision(groupKey, patch) {
    setDecisions((current) => ({
      ...current,
      [groupKey]: { ...current[groupKey], ...patch }
    }));
  }

  function chooseFiles(nextFiles) {
    const selected = Array.from(nextFiles || []);
    setError('');
    setPreview(null);
    setResult(null);
    if (!selected.length) {
      setFiles([]);
      return;
    }
    if (selected.length > 20) {
      setError('Puoi caricare al massimo 20 PDF per volta.');
      return;
    }
    const tooLarge = selected.find((file) => file.size > 4 * 1024 * 1024);
    if (tooLarge) {
      setError(`${tooLarge.name} supera il limite di 4 MB.`);
      return;
    }
    const invalid = selected.find((file) => file.type && file.type !== 'application/pdf');
    if (invalid) {
      setError(`${invalid.name} non è un file PDF.`);
      return;
    }
    setFiles(selected);
  }

  async function analyze() {
    if (!files.length) {
      setError('Seleziona almeno un PDF.');
      return;
    }
    setBusy('preview');
    setError('');
    try {
      const response = await api.previewFederationPdfImport(files, { gameId, reportId });
      setPreview(response.preview);
      setDecisions(Object.fromEntries(
        response.preview.groups.map((group) => [group.groupKey, initialDecision(group)])
      ));
      const [directories, observers] = await Promise.all([
        Promise.all(response.preview.groups.map(async (group) => {
          try {
            const data = await api.listReferees({
              season: group.sportSeason,
              competition: group.header.competition,
              activeOnly: false
            });
            return [group.groupKey, data.referees || []];
          } catch {
            return [group.groupKey, []];
          }
        })),
        api.listGameObservers().catch(() => ({ observers: [] }))
      ]);
      setRefereesByGroup(Object.fromEntries(directories));
      setObserverDirectory(observers.observers || []);
    } catch (err) {
      setError(err.message || 'Analisi dei PDF non riuscita.');
    } finally {
      setBusy('');
    }
  }

  async function applyImport() {
    const incomplete = selectedGroups.find((group) => !decisionReady(group, decisions[group.groupKey]));
    if (!selectedGroups.length) {
      setError('Seleziona almeno una gara da importare.');
      return;
    }
    if (incomplete) {
      setError(`Completa gli abbinamenti e le conferme per la gara ${incomplete.matchNumber}.`);
      return;
    }
    const payload = selectedGroups.map((group) => {
      const decision = decisions[group.groupKey];
      return {
        groupKey: group.groupKey,
        fileHashes: group.files.map((file) => file.hash),
        gameId: Number(decision.gameId),
        reportId: decision.reportId ? Number(decision.reportId) : null,
        firstRefereeId: Number(decision.firstRefereeId),
        secondRefereeId: Number(decision.secondRefereeId),
        observerUserId: decision.observerUserId ? Number(decision.observerUserId) : null,
        sharedSourceRole: decision.sharedSourceRole || null,
        replaceExisting: Boolean(decision.replaceExisting)
      };
    });
    setBusy('apply');
    setError('');
    try {
      const response = await api.applyFederationPdfImport(files, payload, { gameId, reportId });
      setResult(response.result);
      onImported?.(response.result);
    } catch (err) {
      setError(err.message || 'Importazione non riuscita.');
    } finally {
      setBusy('');
    }
  }

  return createPortal(
    <div className="modal-overlay pdf-import-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="modal-box pdf-import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Importazione rapporti PDF federali"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pdf-import-heading">
          <div>
            <p className="eyebrow">Importazione deterministica</p>
            <h3>Rapporti PDF federali</h3>
            <p>I ruoli vengono letti dal campo ARBITRO interno al documento. Il nome del file non viene usato.</p>
          </div>
          <button type="button" className="pdf-import-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Chiudi">×</button>
        </div>

        {!preview && !result ? (
          <div className="pdf-import-start">
            <button
              type="button"
              className="pdf-dropzone"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); chooseFiles(event.dataTransfer.files); }}
            >
              <strong>{files.length ? `${files.length} PDF selezionati` : 'Seleziona o trascina i PDF'}</strong>
              <span>Massimo 20 file · 4 MB ciascuno · solo template digitale federale</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(event) => chooseFiles(event.target.files)}
            />
            {files.length ? (
              <div className="pdf-file-list">
                {files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
              </div>
            ) : null}
          </div>
        ) : null}

        {preview && !result ? (
          <div className="pdf-import-preview">
            <div className="pdf-import-summary">
              <strong>{preview.summary.parsed} PDF letti · {preview.summary.groups} gare</strong>
              <span>{preview.fileErrors.length ? `${preview.fileErrors.length} file con errore` : 'Tutti i file sono leggibili'}</span>
            </div>

            {preview.fileErrors.map((item) => (
              <div className="error-banner" key={item.hash}><strong>{item.originalName}</strong><span>{item.message}</span></div>
            ))}

            {preview.groups.map((group) => {
              const decision = decisions[group.groupKey] || initialDecision(group);
              const selectedPeople = peopleFor(group, decision);
              const reports = reportCandidatesFor(group, decision.gameId);
              const officialChanges = designationChanges(group, decision);
              const ready = decisionReady(group, decision);
              return (
                <section className={`pdf-import-group${ready ? ' is-ready' : ' needs-input'}`} key={group.groupKey}>
                  <div className="pdf-import-group-title">
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(decision.selected)}
                        onChange={(event) => setDecision(group.groupKey, { selected: event.target.checked })}
                      />
                      <span>
                        <strong>Gara {group.matchNumber}</strong>
                        <small>{group.header.teamHome} – {group.header.teamAway} · {group.sportSeason}</small>
                      </span>
                    </label>
                    <span className={`status-badge ${ready ? 'pdf-ready' : 'pdf-warning'}`}>
                      {ready ? 'Pronta' : 'Da verificare'}
                    </span>
                  </div>

                  <div className="pdf-import-files">
                    {group.files.map((file) => (
                      <div key={file.hash}>
                        <strong>{ROLE_LABELS[file.role]}</strong>
                        <span>{file.targetRefereeName}</span>
                        <small>Voto {file.vote || '—'} · {file.originalName}</small>
                      </div>
                    ))}
                  </div>

                  {group.duplicateRoles.length ? (
                    <div className="error-banner">Sono presenti due PDF per lo stesso ruolo.</div>
                  ) : null}
                  {group.gameWarnings.length ? (
                    <div className="pdf-inline-warning">
                      I dati della gara non coincidono per: {group.gameWarnings.map((item) => HEADER_LABELS[item.field] || item.field).join(', ')}.
                      Conferma manualmente la gara corretta.
                    </div>
                  ) : null}
                  {officialChanges.length ? (
                    <div className="pdf-inline-warning">
                      La conferma aggiornerà e bloccherà nella gara: {officialChanges.map((item) =>
                        `${item.label} (${item.current?.name || 'non assegnato'} → ${item.incoming})`
                      ).join('; ')}.
                    </div>
                  ) : null}

                  <div className="pdf-import-grid">
                    <label className="field field-span-2">
                      Gara collegata
                      <Select
                        value={decision.gameId ? String(decision.gameId) : ''}
                        onChange={(value) => {
                          const nextReports = reportCandidatesFor(group, value);
                          setDecision(group.groupKey, {
                            gameId: value,
                            reportId: nextReports.length === 1 ? String(nextReports[0].id) : '',
                            replaceExisting: false
                          });
                        }}
                        placeholder="— Seleziona la gara —"
                        options={group.gameCandidates.map((game) => ({ value: String(game.id), label: gameLabel(game) }))}
                        searchable
                      />
                    </label>

                    <label className="field">
                      1° arbitro
                      <Select
                        value={decision.firstRefereeId ? String(decision.firstRefereeId) : ''}
                        onChange={(value) => setDecision(group.groupKey, { firstRefereeId: value })}
                        placeholder="— Associa —"
                        options={refereeOptions(selectedPeople.first, refereesByGroup[group.groupKey])}
                        searchable
                      />
                    </label>
                    <label className="field">
                      2° arbitro
                      <Select
                        value={decision.secondRefereeId ? String(decision.secondRefereeId) : ''}
                        onChange={(value) => setDecision(group.groupKey, { secondRefereeId: value })}
                        placeholder="— Associa —"
                        options={refereeOptions(selectedPeople.second, refereesByGroup[group.groupKey])}
                        searchable
                      />
                    </label>
                    <label className="field field-span-2">
                      Valutatore: {selectedPeople.observer.externalName}
                      <Select
                        value={decision.observerUserId ? String(decision.observerUserId) : ''}
                        onChange={(value) => setDecision(group.groupKey, { observerUserId: value })}
                        options={observerOptions(selectedPeople.observer, observerDirectory)}
                        placeholder="Non associare a un utente"
                        searchable
                      />
                    </label>

                    {group.requiresSharedSource ? (
                      <label className="field field-span-2">
                        Dati comuni discordanti: {group.sharedDifferences.map((field) => HEADER_LABELS[field] || field).join(', ')}
                        <Select
                          value={decision.sharedSourceRole || ''}
                          onChange={(value) => {
                            const sourcePeople = group.peopleBySource?.[value] || group.people;
                            setDecision(group.groupKey, {
                              sharedSourceRole: value,
                              firstRefereeId: sourcePeople.first.refereeId || '',
                              secondRefereeId: sourcePeople.second.refereeId || '',
                              observerUserId: sourcePeople.observer.userId || ''
                            });
                          }}
                          placeholder="— Scegli il PDF da usare —"
                          options={group.presentRoles.map((role) => ({ value: role, label: `Usa il PDF del ${ROLE_LABELS[role]}` }))}
                        />
                      </label>
                    ) : null}

                    {reports.length ? (
                      <label className="field field-span-2">
                        Rapporto esistente
                        <Select
                          value={decision.reportId ? String(decision.reportId) : ''}
                          onChange={(value) => setDecision(group.groupKey, { reportId: value, replaceExisting: false })}
                          placeholder={reports.length > 1 ? '— Seleziona il rapporto —' : 'Rapporto trovato'}
                          options={reports.map((report) => ({
                            value: String(report.id),
                            label: `Rapporto #${report.id} · ${report.status === 'final' ? 'Definitivo' : 'Bozza'} · ${report.observerName || 'senza osservatore'}`
                          }))}
                        />
                      </label>
                    ) : null}
                  </div>

                  {decision.reportId ? (
                    <label className="pdf-replace-confirm">
                      <input
                        type="checkbox"
                        checked={Boolean(decision.replaceExisting)}
                        onChange={(event) => setDecision(group.groupKey, { replaceExisting: event.target.checked })}
                      />
                      Confermo la sostituzione delle sole valutazioni presenti nei PDF. Le altre restano invariate;
                      per i ruoli sostituiti verrà azzerato lo stato di invio email.
                    </label>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}

        {result ? (
          <div className="pdf-import-result">
            <div className={result.errors.length || result.conflicts?.length ? 'pdf-result-partial' : 'pdf-result-success'}>
              <strong>{result.results.length} gare importate</strong>
              <span>{result.created} rapporti creati · {result.updated} aggiornati</span>
            </div>
            {result.results.map((item) => (
              <button
                type="button"
                className="pdf-result-link"
                key={item.groupKey}
                onClick={() => { onClose(); navigate(`/reports/${item.reportId}`); }}
              >
                Gara {item.groupKey.split('|').at(-1)} · rapporto #{item.reportId} · {item.status === 'final' ? 'Definitivo' : 'Bozza'}
              </button>
            ))}
            {result.errors.map((item, index) => (
              <div className="error-banner" key={`${item.groupKey || item.hash || 'error'}-${index}`}>{item.message}</div>
            ))}
            {(result.conflicts || []).map((item, index) => (
              <div className="pdf-inline-warning" key={`${item.groupKey || 'conflict'}-${index}`}>{item.message}</div>
            ))}
          </div>
        ) : null}

        {error ? <div className="error-banner pdf-import-error">{error}</div> : null}

        <div className="modal-actions pdf-import-actions">
          {!result && preview ? (
            <button type="button" className="ghost-button" onClick={() => { setPreview(null); setDecisions({}); }} disabled={Boolean(busy)}>
              Cambia file
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={onClose} disabled={Boolean(busy)}>
            {result ? 'Chiudi' : 'Annulla'}
          </button>
          {!preview && !result ? (
            <button type="button" className="primary-button" onClick={analyze} disabled={!files.length || Boolean(busy)}>
              {busy === 'preview' ? 'Analizzo…' : 'Analizza PDF'}
            </button>
          ) : null}
          {preview && !result ? (
            <button type="button" className="primary-button" onClick={applyImport} disabled={Boolean(busy)}>
              {busy === 'apply' ? 'Importo…' : `Importa ${selectedGroups.length || ''}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
