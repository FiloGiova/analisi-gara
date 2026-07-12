import { useEffect, useState } from 'react';
import { COMPETITIONS } from '../../../shared/reportTemplate.js';
import Select from '../components/Select.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import GameStateBadge from '../components/GameStateBadge.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';

const REFEREE_ROLES = [
  { role: 'referee1', label: '1° arbitro' },
  { role: 'referee2', label: '2° arbitro' },
  { role: 'referee3', label: '3° arbitro' }
];

const SOURCE_LABELS = {
  fip_public: 'FIP',
  xlsx: 'XLSX',
  manual: 'Manuale'
};

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'In programma' },
  { value: 'played', label: 'Giocata' },
  { value: 'postponed', label: 'Rinviata' },
  { value: 'cancelled', label: 'Annullata' }
];

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    const day = date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = iso.length > 10 ? date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    return time && time !== '00:00' ? `${day} · ${time}` : day;
  } catch {
    return iso;
  }
}

function SourceBadge({ official }) {
  if (!official) return null;
  return (
    <span className="status-badge" style={{ background: 'var(--blue-soft)', color: 'var(--blue)', padding: '3px 8px', fontSize: '0.7rem' }}>
      {SOURCE_LABELS[official.source] || official.source}
      {official.manualLock ? ' · bloccato' : ''}
    </span>
  );
}

export default function GameDetailPage({ id, currentUser }) {
  const canManage = currentUser.role === 'admin' || currentUser.role === 'instructor';
  const isAdmin = currentUser.role === 'admin';
  const [game, setGame] = useState(null);
  const [referees, setReferees] = useState([]);
  const [observers, setObservers] = useState([]);
  const [candidatesByRole, setCandidatesByRole] = useState({});
  const [aliasSelection, setAliasSelection] = useState({});
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [pendingForce, setPendingForce] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [openRefEditors, setOpenRefEditors] = useState({}); // role -> mostra i controlli di riassegnazione
  const [observerAliasSel, setObserverAliasSel] = useState('');
  const [observerCandidates, setObserverCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getGame(id);
      setGame(data.game);
      if (canManage) {
        const roles = ['referee1', 'referee2', 'referee3'];
        const unresolved = roles
          .map((role) => ({ role, official: data.game.officials[role] }))
          .filter(({ official }) => official && !official.refereeId && official.externalName);
        const results = {};
        for (const { role, official } of unresolved) {
          try {
            const res = await api.getAliasCandidates(official.externalName);
            results[role] = res.candidates || [];
          } catch {
            results[role] = [];
          }
        }
        setCandidatesByRole(results);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare la gara.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (!canManage) return;
    api.listGameObservers()
      .then((data) => setObservers(data.observers || []))
      .catch(() => setObservers([]));
  }, [canManage]);

  useEffect(() => {
    if (!canManage || !game) return;
    api.listReferees({ season: game.sportSeason })
      .then((data) => setReferees(data.referees || []))
      .catch(() => setReferees([]));
  }, [canManage, game?.sportSeason]);

  function startEdit() {
    setEditForm({
      matchday: game.matchday ?? '',
      scheduledDate: game.scheduledAt ? game.scheduledAt.slice(0, 10) : '',
      scheduledTime: game.scheduledAt && game.scheduledAt.length > 10 ? game.scheduledAt.slice(11, 16) : '',
      teamHome: game.teamHome,
      teamAway: game.teamAway,
      venue: game.venue,
      competition: game.competition,
      status: game.status,
      scoreHome: game.scoreHome,
      scoreAway: game.scoreAway,
      reason: ''
    });
    setEditing(true);
    setSuccess('');
    setError('');
  }

  function buildUpdatePayload(form) {
    const scheduledAt = form.scheduledDate
      ? form.scheduledTime
        ? `${form.scheduledDate}T${form.scheduledTime}`
        : form.scheduledDate
      : '';
    return {
      matchday: form.matchday,
      scheduledAt,
      teamHome: form.teamHome,
      teamAway: form.teamAway,
      venue: form.venue,
      competition: form.competition,
      status: form.status,
      scoreHome: form.scoreHome,
      scoreAway: form.scoreAway,
      reason: form.reason
    };
  }

  async function saveEdit(force = false) {
    setBusy(true);
    setError('');
    try {
      const payload = { ...buildUpdatePayload(editForm), force };
      const data = await api.updateGame(id, payload);
      setGame(data.game);
      setEditing(false);
      setPendingForce(null);
      setSuccess('Gara aggiornata.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.requiresConfirmation) {
        setPendingForce(editForm);
      } else {
        setError(err instanceof ApiError ? err.message : 'Aggiornamento non riuscito.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function assignOfficial(role, { refereeId = null, userId = null, externalName = '', manualLock = false }) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.setGameOfficial(id, role, { refereeId, userId, externalName, manualLock });
      setGame(data.game);
      setSuccess('Designazione aggiornata.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Operazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function clearOfficial(role) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.removeGameOfficial(id, role);
      setGame(data.game);
      setSuccess('Designazione rimossa.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Operazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmAlias(role, official) {
    const refereeId = aliasSelection[role];
    if (!refereeId) return;
    setBusy(true);
    setError('');
    try {
      await api.saveGameAlias({ source: official.source, externalName: official.externalName, refereeId: Number(refereeId) });
      setSuccess(`Nominativo "${official.externalName}" associato: verrà riconosciuto anche nelle prossime sincronizzazioni.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Associazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function loadSuggestions() {
    setSuggestBusy(true);
    setError('');
    try {
      const data = await api.getObserverSuggestions(id);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suggerimenti non disponibili.');
    } finally {
      setSuggestBusy(false);
    }
  }

  async function confirmObserverAlias(official) {
    if (!observerAliasSel) return;
    setBusy(true);
    setError('');
    try {
      await api.saveGameAlias({ source: official.source, externalName: official.externalName, userId: Number(observerAliasSel) });
      setSuccess(`Osservatore "${official.externalName}" associato: verrà riconosciuto anche nei prossimi import.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Associazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const observerOfficial = game?.officials?.observer;
    if (!isAdmin || !observerOfficial || observerOfficial.userId || !observerOfficial.externalName) {
      setObserverCandidates([]);
      return;
    }
    api.getAliasCandidates(observerOfficial.externalName, 'observer')
      .then((data) => setObserverCandidates(data.candidates || []))
      .catch(() => setObserverCandidates([]));
  }, [isAdmin, game?.officials?.observer?.externalName, game?.officials?.observer?.userId]);

  async function toggleLock(role, official) {
    await assignOfficial(role, {
      refereeId: official.refereeId,
      userId: official.userId,
      externalName: official.externalName,
      manualLock: !official.manualLock
    });
  }

  if (loading) return <div className="empty-state">Caricamento gara…</div>;
  if (!game) {
    return (
      <div className="empty-state">
        <h2>Gara non trovata</h2>
        {error ? <p>{error}</p> : null}
        <button type="button" className="primary-button" onClick={() => navigate('/games')}>Torna alle gare</button>
      </div>
    );
  }

  const observer = game.officials.observer || null;

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">
            {game.sportSeason}
            {game.matchday ? ` · Giornata ${game.matchday}` : ''}
            {game.competition ? ` · ${game.competition}` : ''}
          </p>
          <h1>Gara {game.matchNumber}</h1>
          <p style={{ fontWeight: 600 }}>
            {game.teamHome} - {game.teamAway}
            {game.scoreHome !== '' && game.scoreAway !== '' ? ` (${game.scoreHome}-${game.scoreAway})` : ''}
          </p>
          <p style={{ color: 'var(--muted)' }}>
            {formatDateTime(game.scheduledAt)}
            {game.venue ? ` · ${game.venue}` : ''}
          </p>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
            <GameStateBadge state={game.derivedState} />
            <span className="status-badge" style={{ background: 'var(--paper-2)', color: 'var(--muted)', padding: '3px 8px', fontSize: '0.72rem' }}>
              Origine: {SOURCE_LABELS[game.externalSource] || game.externalSource}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {game.reportId ? (
            <button type="button" className="hero-button" onClick={() => navigate(`/reports/${game.reportId}`)}>
              Apri rapporto
            </button>
          ) : (
            <button type="button" className="hero-button" onClick={() => navigate(`/reports/new?game=${game.id}`)}>
              Compila rapporto
            </button>
          )}
          {canManage && !editing ? (
            <button type="button" className="ghost-button" onClick={startEdit}>Modifica gara</button>
          ) : null}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      {editing && editForm ? (
        <form
          className="common-card"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit(false);
          }}
        >
          <div className="section-heading">
            <div>
              <h2>Modifica gara</h2>
              <p>Le modifiche vengono registrate nello storico con autore e data.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setEditing(false)}>Annulla</button>
          </div>
          <div className="common-grid">
            <label className="field field-span-2">
              Giornata
              <input inputMode="numeric" value={editForm.matchday} onChange={(e) => setEditForm({ ...editForm, matchday: e.target.value })} />
            </label>
            <label className="field field-span-2">
              Data
              <input type="date" value={editForm.scheduledDate} onChange={(e) => setEditForm({ ...editForm, scheduledDate: e.target.value })} />
            </label>
            <label className="field field-span-2">
              Ora
              <input type="time" value={editForm.scheduledTime} onChange={(e) => setEditForm({ ...editForm, scheduledTime: e.target.value })} />
            </label>
            <label className="field field-span-3">
              Squadra casa
              <input value={editForm.teamHome} onChange={(e) => setEditForm({ ...editForm, teamHome: e.target.value })} />
            </label>
            <label className="field field-span-3">
              Squadra ospite
              <input value={editForm.teamAway} onChange={(e) => setEditForm({ ...editForm, teamAway: e.target.value })} />
            </label>
            <label className="field field-span-2">
              Campionato
              <Select
                value={editForm.competition}
                onChange={(v) => setEditForm({ ...editForm, competition: v })}
                placeholder="— Seleziona —"
                options={COMPETITIONS.map((c) => ({ value: c.value, label: c.label }))}
              />
            </label>
            <label className="field field-span-2">
              Stato
              <Select
                value={editForm.status}
                onChange={(v) => setEditForm({ ...editForm, status: v })}
                options={STATUS_OPTIONS}
              />
            </label>
            <label className="field field-span-2">
              Campo
              <input value={editForm.venue} onChange={(e) => setEditForm({ ...editForm, venue: e.target.value })} />
            </label>
            <label className="field">
              Punti casa
              <input inputMode="numeric" value={editForm.scoreHome} onChange={(e) => setEditForm({ ...editForm, scoreHome: e.target.value })} />
            </label>
            <label className="field">
              Punti ospite
              <input inputMode="numeric" value={editForm.scoreAway} onChange={(e) => setEditForm({ ...editForm, scoreAway: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              Motivazione (facoltativa, salvata nello storico)
              <input value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} placeholder="es. rinviata per impraticabilità campo" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={() => setEditing(false)}>Annulla</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Salvataggio...' : 'Salva modifiche'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Arbitri designati</h2>
            <p>Dati con provenienza: FIP pubblico, import XLSX o inserimento manuale.</p>
          </div>
        </div>
        <div style={{ display: 'grid', gap: '14px' }}>
          {REFEREE_ROLES.map(({ role, label }) => {
            const official = game.officials[role];
            const unresolved = official && !official.refereeId && official.externalName;
            return (
              <div key={role} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--line-soft)' }}>
                <strong style={{ minWidth: '90px' }}>{label}</strong>
                {official ? (
                  <>
                    <span style={{ fontWeight: 600 }}>
                      {official.refereeName || official.externalName}
                    </span>
                    {official.refereeName && official.externalName && official.refereeName !== official.externalName ? (
                      <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>({official.externalName})</span>
                    ) : null}
                    <SourceBadge official={official} />
                    {unresolved ? (
                      <span className="status-badge" style={{ background: 'var(--paper-2)', color: 'var(--danger)', padding: '3px 8px', fontSize: '0.72rem' }}>
                        Da associare all'anagrafica
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>{role === 'referee3' ? 'Non previsto' : 'Non ancora designato'}</span>
                )}
                {canManage && official && !openRefEditors[role] ? (
                  <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="ghost-button" onClick={() => setOpenRefEditors((p) => ({ ...p, [role]: true }))}>
                      Modifica
                    </button>
                  </div>
                ) : null}
                {canManage && (!official || openRefEditors[role]) ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={official?.refereeId ? String(official.refereeId) : ''}
                      onChange={(v) => {
                        if (!v) return;
                        const referee = referees.find((r) => String(r.id) === v);
                        assignOfficial(role, { refereeId: Number(v), externalName: referee?.fullName || '' });
                        setOpenRefEditors((p) => ({ ...p, [role]: false }));
                      }}
                      placeholder="Assegna dall'anagrafica…"
                      options={referees.map((r) => ({ value: String(r.id), label: r.fullName || `${r.lastName} ${r.firstName}` }))}
                      searchable
                    />
                    {official ? (
                      <>
                        <button type="button" className="ghost-button" onClick={() => toggleLock(role, official)} disabled={busy}>
                          {official.manualLock ? 'Sblocca' : 'Blocca'}
                        </button>
                        <button type="button" className="danger-button" onClick={() => clearOfficial(role)} disabled={busy}>
                          Rimuovi
                        </button>
                        <button type="button" className="ghost-button" onClick={() => setOpenRefEditors((p) => ({ ...p, [role]: false }))}>
                          Fine
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {isAdmin && unresolved ? (
                  <div style={{ flexBasis: '100%', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', paddingLeft: '90px' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Associa a:</span>
                    <Select
                      value={aliasSelection[role] || ''}
                      onChange={(v) => setAliasSelection({ ...aliasSelection, [role]: v })}
                      placeholder={candidatesByRole[role]?.length ? 'Candidati proposti…' : 'Nessun candidato: cerca…'}
                      options={[
                        ...(candidatesByRole[role] || []).map((c) => ({
                          value: String(c.refereeId),
                          label: `${c.fullName}${c.active ? '' : ' (inattivo)'} · affinità ${Math.round(c.score * 100)}%`
                        })),
                        ...referees
                          .filter((r) => !(candidatesByRole[role] || []).some((c) => c.refereeId === r.id))
                          .map((r) => ({ value: String(r.id), label: r.fullName || `${r.lastName} ${r.firstName}` }))
                      ]}
                      searchable
                    />
                    <button type="button" className="primary-button" onClick={() => confirmAlias(role, official)} disabled={busy || !aliasSelection[role]}>
                      Conferma associazione
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Osservatore</h2>
            <p>
              L'osservatore è interno e non viene mai toccato dalle sincronizzazioni FIP. Una gara
              senza osservatore è una gara scoperta: stato normale, non un errore.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          {observer ? (
            <>
              <span style={{ fontWeight: 600 }}>{observer.userName || observer.externalName}</span>
              <SourceBadge official={observer} />
              {!observer.userId && observer.externalName ? (
                <span className="status-badge" style={{ background: 'var(--paper-2)', color: 'var(--danger)', padding: '3px 8px', fontSize: '0.72rem' }}>
                  Da associare a un utente
                </span>
              ) : null}
            </>
          ) : (
            <span className="status-badge" style={{ background: 'var(--orange-soft)', color: 'var(--orange)', padding: '3px 8px' }}>
              Gara scoperta
            </span>
          )}
          {canManage ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button type="button" className="ghost-button" onClick={() => (suggestions ? setSuggestions(null) : loadSuggestions())} disabled={suggestBusy}>
                {suggestBusy ? 'Calcolo…' : suggestions ? 'Nascondi suggerimenti' : 'Suggerisci osservatore'}
              </button>
              <Select
                value={observer?.userId ? String(observer.userId) : ''}
                onChange={(v) => {
                  if (!v) return;
                  assignOfficial('observer', { userId: Number(v) });
                }}
                placeholder="Assegna osservatore…"
                options={observers.map((o) => ({ value: String(o.id), label: o.displayName }))}
                searchable
              />
              {observer ? (
                <button type="button" className="danger-button" onClick={() => clearOfficial('observer')} disabled={busy}>
                  Rimuovi
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {isAdmin && observer && !observer.userId && observer.externalName ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Associa "{observer.externalName}" a:</span>
            <Select
              value={observerAliasSel}
              onChange={setObserverAliasSel}
              placeholder={observerCandidates.length ? 'Candidati proposti…' : 'Scegli utente…'}
              options={[
                ...observerCandidates.map((c) => ({
                  value: String(c.userId),
                  label: `${c.displayName}${c.active ? '' : ' (inattivo)'} · affinità ${Math.round(c.score * 100)}%`
                })),
                ...observers
                  .filter((o) => !observerCandidates.some((c) => c.userId === o.id))
                  .map((o) => ({ value: String(o.id), label: o.displayName }))
              ]}
              searchable
            />
            <button type="button" className="primary-button" onClick={() => confirmObserverAlias(observer)} disabled={busy || !observerAliasSel}>
              Conferma associazione
            </button>
          </div>
        ) : null}

        {suggestions ? (
          <div style={{ marginTop: '14px', borderTop: '1px solid var(--line-soft)', paddingTop: '12px' }}>
            <div className="section-heading">
              <div>
                <h3>Graduatoria candidati</h3>
                <p>
                  Ordinati per diversificazione: chi ha visto meno questi due arbitri viene prima.
                  Punteggio deterministico e spiegato, nessuna scelta è vincolante.
                </p>
              </div>
            </div>
            {suggestions.length === 0 ? (
              <div className="empty-state" style={{ padding: '14px' }}>Nessun candidato disponibile.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="referee-table">
                  <thead>
                    <tr>
                      <th>Candidato</th>
                      <th>Punti</th>
                      <th>V. arb.1</th>
                      <th>V. arb.2</th>
                      <th>Carico</th>
                      <th>Ultimo incrocio</th>
                      <th>Motivazione</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s) => (
                      <tr key={s.userId} style={s.sameDayCount ? { background: 'rgba(220, 53, 69, 0.06)' } : undefined}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {s.displayName}
                          {s.sameDayCount ? (
                            <span
                              className="status-badge"
                              style={{ marginLeft: '8px', background: '#fdecea', color: 'var(--danger)', padding: '2px 8px', fontSize: '0.68rem', whiteSpace: 'nowrap' }}
                            >
                              ⚠ Già designato quel giorno
                            </span>
                          ) : null}
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--blue)' }}>{s.score}</td>
                        <td>{s.seenRef1}</td>
                        <td>{s.seenRef2}</td>
                        <td>{s.totalSeason}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{s.lastCrossDate ? formatDateTime(s.lastCrossDate) : 'mai'}</td>
                        <td style={{ fontSize: '0.82rem', color: s.sameDayCount ? 'var(--danger)' : 'var(--muted)' }}>{s.reasons.join(' ')}</td>
                        <td>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={async () => {
                              await assignOfficial('observer', { userId: s.userId });
                              setSuggestions(null);
                            }}
                            disabled={busy}
                          >
                            Assegna
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Storico modifiche</h2>
            <p>Ogni variazione (manuale o da sincronizzazione) è registrata e ricostruibile.</p>
          </div>
        </div>
        {game.changes?.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="referee-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Campo</th>
                  <th>Da</th>
                  <th>A</th>
                  <th>Origine</th>
                  <th>Autore</th>
                  <th>Motivazione</th>
                </tr>
              </thead>
              <tbody>
                {game.changes.map((change) => (
                  <tr key={change.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{formatDateTime(change.createdAt)}</td>
                    <td>{change.field}</td>
                    <td style={{ color: 'var(--muted)' }}>{change.oldValue || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{change.newValue || '—'}</td>
                    <td>{SOURCE_LABELS[change.source] || change.source}</td>
                    <td>{change.changedByName || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{change.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '16px' }}>Nessuna modifica registrata.</div>
        )}
      </section>

      {pendingForce ? (
        <ConfirmModal
          title="Gara collegata a un rapporto definitivo"
          confirmLabel="Modifica comunque"
          onConfirm={() => saveEdit(true)}
          onCancel={() => setPendingForce(null)}
        >
          Questa gara è collegata a un rapporto definitivo: modificarla può rendere incoerente lo
          storico. La modifica verrà comunque registrata nello storico con la motivazione indicata.
        </ConfirmModal>
      ) : null}
    </div>
  );
}
