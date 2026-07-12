import { Fragment, useEffect, useMemo, useState } from 'react';
import { COMPETITIONS, currentSportSeason } from '../../../shared/reportTemplate.js';
import Select from '../components/Select.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import GameStateBadge from '../components/GameStateBadge.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';

const CURRENT_SEASON = currentSportSeason();

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

function refereeLabel(official) {
  if (!official) return '—';
  return official.refereeName || official.externalName || '—';
}

export default function DesignateObserversPage({ currentUser }) {
  const canManage = currentUser.role === 'admin' || currentUser.role === 'instructor';
  const season = CURRENT_SEASON;
  const [games, setGames] = useState([]);
  const [observers, setObservers] = useState([]);
  const [competition, setCompetition] = useState('');
  const [sourceFilter, setSourceFilter] = useState([]); // fasi (nomi sorgente)
  const [matchdayFilter, setMatchdayFilter] = useState([]); // giornate (stringhe)
  const [suggestions, setSuggestions] = useState({}); // gameId -> { loading } | { error } | { items }
  const [openSuggest, setOpenSuggest] = useState(null); // gameId con pannello suggerimenti aperto
  const [loading, setLoading] = useState(true);
  const [busyGame, setBusyGame] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadGames() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listGames({ season });
      setGames(data.games || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare le gare.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canManage) loadGames();
  }, []);

  useEffect(() => {
    if (!canManage) return;
    api.listGameObservers()
      .then((data) => setObservers(data.observers || []))
      .catch(() => setObservers([]));
  }, [canManage]);

  // Il formatore sceglie solo tra i propri campionati; l'admin tra quelli presenti.
  const competitionOptions = useMemo(() => {
    if (currentUser.role === 'instructor') {
      const mine = currentUser.instructorCompetitions?.length
        ? currentUser.instructorCompetitions
        : [currentUser.instructorCompetition, currentUser.formatterCompetition].filter(Boolean);
      return mine;
    }
    const present = Array.from(new Set(games.map((g) => g.competition).filter(Boolean)));
    return present.length ? present : COMPETITIONS.map((c) => c.value);
  }, [currentUser, games]);

  const gamesInCompetition = useMemo(
    () => (competition ? games.filter((g) => g.competition === competition) : games),
    [games, competition]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(gamesInCompetition.map((g) => g.sourceName).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [gamesInCompetition]
  );

  const matchdayOptions = useMemo(
    () => Array.from(new Set(gamesInCompetition.map((g) => g.matchday).filter((m) => m !== null))).sort((a, b) => a - b),
    [gamesInCompetition]
  );

  // Di default non si mostra nulla: bisogna prima scegliere almeno un filtro.
  const hasFilter = Boolean(competition) || sourceFilter.length > 0 || matchdayFilter.length > 0;

  const filtered = games.filter((game) => {
    if (game.status === 'cancelled') return false;
    if (competition && game.competition !== competition) return false;
    if (sourceFilter.length && !sourceFilter.includes(game.sourceName)) return false;
    if (matchdayFilter.length && !matchdayFilter.includes(String(game.matchday))) return false;
    return true;
  });

  async function assignObserver(gameId, userId) {
    if (!userId) return;
    setBusyGame(gameId);
    setError('');
    setSuccess('');
    try {
      const data = await api.setGameOfficial(gameId, 'observer', { userId });
      setGames((prev) => prev.map((g) => (g.id === gameId ? data.game : g)));
      setSuccess(`Osservatore assegnato alla gara ${data.game.matchNumber}.`);
      setOpenSuggest(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Assegnazione non riuscita.');
    } finally {
      setBusyGame(null);
    }
  }

  async function toggleSuggestions(gameId) {
    if (openSuggest === gameId) {
      setOpenSuggest(null);
      return;
    }
    setOpenSuggest(gameId);
    if (suggestions[gameId]?.items || suggestions[gameId]?.error) return; // già caricato
    setSuggestions((prev) => ({ ...prev, [gameId]: { loading: true } }));
    try {
      const data = await api.getObserverSuggestions(gameId);
      setSuggestions((prev) => ({ ...prev, [gameId]: { items: data.suggestions || [] } }));
    } catch (err) {
      setSuggestions((prev) => ({
        ...prev,
        [gameId]: { error: err instanceof ApiError ? err.message : 'Suggerimenti non disponibili.' }
      }));
    }
  }

  if (!canManage) {
    return <div className="empty-state"><h2>Sezione riservata ad amministratori e formatori</h2></div>;
  }

  const observerOptions = observers.map((o) => ({ value: String(o.id), label: o.displayName }));

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Stagione {season}</p>
          <h1>Designa osservatori</h1>
          <p>
            Assegna velocemente gli osservatori su più gare. Filtra per campionato, fase e giornata,
            poi scegli l'osservatore riga per riga (con il suggeritore per la diversificazione).
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => navigate('/games')}>
          Torna alle gare
        </button>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="common-card">
        <div className="games-filters-row">
          <div style={{ flex: '0 1 200px' }}>
            <Select
              value={competition}
              onChange={(v) => { setCompetition(v); setSourceFilter([]); setMatchdayFilter([]); }}
              placeholder="Tutti i campionati"
              options={[{ value: '', label: 'Tutti i campionati' }, ...competitionOptions.map((c) => ({ value: c, label: COMPETITIONS.find((x) => x.value === c)?.label || c }))]}
            />
          </div>
          {sourceOptions.length ? (
            <div className="games-filter-fase">
              <MultiSelect
                values={sourceFilter}
                onChange={setSourceFilter}
                allLabel="Tutte le fasi"
                options={sourceOptions.map((s) => ({ value: s, label: s }))}
              />
            </div>
          ) : null}
          <div style={{ flex: '0 1 200px' }}>
            <MultiSelect
              values={matchdayFilter}
              onChange={setMatchdayFilter}
              allLabel="Tutte le giornate"
              options={matchdayOptions.map((m) => ({ value: String(m), label: `Giornata ${m}` }))}
            />
          </div>
        </div>

        {!hasFilter ? (
          <div className="empty-state" style={{ padding: '28px', textAlign: 'center' }}>
            <h3>Scegli i filtri</h3>
            <p>Seleziona campionato, fase o giornata per vedere le gare da coprire.</p>
          </div>
        ) : null}

        {hasFilter ? (
          <div className="section-heading" style={{ marginTop: '14px' }}>
            <div>
              <h2>Gare ({filtered.length})</h2>
              <p>Le gare senza osservatore sono scoperte: sono quelle da coprire.</p>
            </div>
          </div>
        ) : null}

        {hasFilter && loading ? <div className="empty-state" style={{ padding: '24px' }}>Caricamento…</div> : null}

        {hasFilter && !loading && filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
            Nessuna gara corrisponde ai filtri.
          </div>
        ) : null}

        {hasFilter && !loading && filtered.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="referee-table">
              <thead>
                <tr>
                  <th>N. gara</th>
                  <th>Data</th>
                  <th>Giorn.</th>
                  <th>Incontro</th>
                  <th>1° arbitro</th>
                  <th>2° arbitro</th>
                  <th style={{ minWidth: '260px' }}>Osservatore</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((game) => {
                  const observer = game.officials.observer || null;
                  const sug = suggestions[game.id];
                  const isOpen = openSuggest === game.id;
                  return (
                    <Fragment key={game.id}>
                      <tr>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{game.matchNumber}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{formatDateTime(game.scheduledAt)}</td>
                        <td style={{ color: 'var(--muted)' }}>{game.matchday ?? '—'}</td>
                        <td style={{ fontWeight: 600 }}>{game.teamHome} - {game.teamAway}</td>
                        <td>{refereeLabel(game.officials.referee1)}</td>
                        <td>{refereeLabel(game.officials.referee2)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <GameStateBadge state={game.derivedState} />
                            <div style={{ minWidth: '170px' }}>
                              <Select
                                value={observer?.userId ? String(observer.userId) : ''}
                                onChange={(v) => assignObserver(game.id, Number(v))}
                                placeholder={observer ? 'Cambia…' : 'Assegna…'}
                                options={observerOptions}
                                searchable
                              />
                            </div>
                            <button type="button" className="ghost-button" onClick={() => toggleSuggestions(game.id)} disabled={busyGame === game.id}>
                              {isOpen ? 'Nascondi' : 'Suggerisci'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="suggest-panel-row">
                          <td colSpan={7} className="suggest-panel">
                            {sug?.loading ? (
                              <div className="empty-state" style={{ padding: '10px' }}>Calcolo suggerimenti…</div>
                            ) : sug?.error ? (
                              <div className="suggest-error">{sug.error}</div>
                            ) : sug?.items?.length ? (
                              <div className="suggest-list">
                                {sug.items.map((s) => (
                                  <div key={s.userId} className={`suggest-card${s.sameDayCount ? ' is-sameday' : ''}`}>
                                    <span className="suggest-name">{s.displayName}</span>
                                    {s.sameDayCount ? (
                                      <span className="suggest-sameday-badge">⚠ Già designato quel giorno</span>
                                    ) : null}
                                    <span className="suggest-score">{s.score} pt</span>
                                    <span className="suggest-metrics">
                                      <span>1° arb: <b>{s.seenRef1}</b></span>
                                      <span>2° arb: <b>{s.seenRef2}</b></span>
                                      <span>carico: <b>{s.totalSeason}</b></span>
                                    </span>
                                    <span className="suggest-reason">{s.reasons.join(' ')}</span>
                                    <button type="button" className="primary-button" onClick={() => assignObserver(game.id, s.userId)} disabled={busyGame === game.id}>
                                      Assegna
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="empty-state" style={{ padding: '10px' }}>Nessun candidato disponibile.</div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
