import { useEffect, useState } from 'react';
import { COMPETITIONS, currentSportSeason } from '../../../shared/reportTemplate.js';
import Select from '../components/Select.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';

const CURRENT_SEASON = currentSportSeason();

const BANDS = [
  { value: 'esordiente', label: 'Esordienti' },
  { value: 'playoff', label: 'Playoff' },
  { value: 'playout', label: 'Playout' }
];

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('it-IT'); } catch { return iso; }
}

// Soglie incroci: 0 neutro, 1 verde, 2 giallo, 3+ rosso (il numero è sempre visibile).
function cellStyle(completed) {
  if (!completed) return { color: 'var(--muted-2)' };
  if (completed === 1) return { background: 'var(--final-soft)', color: 'var(--final)', fontWeight: 700 };
  if (completed === 2) return { background: 'var(--draft-soft)', color: 'var(--draft)', fontWeight: 700 };
  return { background: 'var(--orange-soft)', color: 'var(--danger)', fontWeight: 800 };
}

export default function CoveragePage({ currentUser }) {
  const canAccess = currentUser.role === 'admin' || currentUser.role === 'instructor';
  const [view, setView] = useState('coverage');
  const season = CURRENT_SEASON; // statistiche sempre sulla stagione corrente
  const [competition, setCompetition] = useState(''); // '' = tutti i campionati
  const [band, setBand] = useState(''); // '' = tutte le fasce
  const [search, setSearch] = useState(''); // filtro nome/cognome/tessera
  const [coverage, setCoverage] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [employment, setEmployment] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canAccess) return;
    setLoading(true);
    setError('');
    setDetail(null);
    Promise.all([
      api.getCoverage({ season, competition, band }),
      api.getMatrix({ season, competition, band }),
      api.getEmployment({ season, competition, band })
    ])
      .then(([cov, mat, emp]) => {
        setCoverage(cov);
        setMatrix(mat);
        setEmployment(emp);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossibile caricare i visionamenti.'))
      .finally(() => setLoading(false));
  }, [canAccess, competition, band]);

  if (!canAccess) {
    return <div className="empty-state"><h2>Sezione riservata ad amministratori e formatori</h2></div>;
  }

  async function openDetail(observer, referee) {
    try {
      const data = await api.getMatrixDetail({ season, competition, observerKey: observer.key, refereeId: referee.refereeId });
      setDetail({ observer, referee, ...data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Dettaglio non disponibile.');
    }
  }

  const searchQuery = search.trim().toLowerCase();
  function matchesSearch(ref) {
    if (!searchQuery) return true;
    return (ref.fullName || '').toLowerCase().includes(searchQuery) || (ref.license || '').toLowerCase().includes(searchQuery);
  }

  const cellsMap = new Map((matrix?.cells || []).map((c) => [`${c.observerKey}|${c.refereeId}`, c]));
  const visibleReferees = (coverage?.referees || []).filter(matchesSearch);

  // Il formatore vede solo i propri campionati; l'admin tutti.
  const myCompetitions = currentUser.role === 'instructor'
    ? (currentUser.instructorCompetitions?.length
        ? currentUser.instructorCompetitions
        : [currentUser.instructorCompetition, currentUser.formatterCompetition].filter(Boolean))
    : COMPETITIONS.map((c) => c.value);
  const competitionSelectOptions = [
    { value: '', label: 'Tutti i campionati' },
    ...myCompetitions.map((c) => ({ value: c, label: COMPETITIONS.find((x) => x.value === c)?.label || c }))
  ];

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Stagione {season}{competition ? ` · ${competition}` : ''}</p>
          <h1>Statistiche</h1>
          <p>
            Calcolate automaticamente da designazioni e rapporti: copertura dei visionamenti,
            incroci osservatore-arbitro e impiego di ogni arbitro nel campionato.
          </p>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="toolbar-card">
        <div className="admin-referee-toolbar">
          <div className="view-switch">
            <button type="button" className={view === 'coverage' ? 'is-active' : ''} onClick={() => setView('coverage')}>
              Copertura arbitri
            </button>
            <button type="button" className={view === 'matrix' ? 'is-active' : ''} onClick={() => setView('matrix')}>
              Matrice incroci
            </button>
            <button type="button" className={view === 'employment' ? 'is-active' : ''} onClick={() => setView('employment')}>
              Impiego arbitri
            </button>
          </div>
        </div>
        <div className="games-filters-row" style={{ marginTop: '12px' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca arbitro: nome, cognome o tessera…"
            style={{ flex: '0 1 340px', minHeight: '46px', boxSizing: 'border-box' }}
          />
          <div style={{ flex: '0 1 240px' }}>
            <Select
              value={competition}
              onChange={setCompetition}
              placeholder="Tutti i campionati"
              options={competitionSelectOptions}
            />
          </div>
          <div style={{ flex: '0 1 180px' }}>
            <Select
              value={band}
              onChange={setBand}
              placeholder="Tutte le fasce"
              options={[{ value: '', label: 'Tutte le fasce' }, ...BANDS]}
            />
          </div>
        </div>
      </section>

      {loading ? <div className="empty-state" style={{ padding: '24px' }}>Caricamento…</div> : null}

      {!loading && view === 'coverage' && coverage ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Copertura arbitri ({visibleReferees.length})</h2>
              <p>Nelle colonne giornata: nome osservatore — ✓ completato, ○ programmato.</p>
            </div>
          </div>
          {visibleReferees.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}>Nessun dato in questa stagione.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="referee-table">
                <thead>
                  <tr>
                    <th>Arbitro</th>
                    <th>Compl.</th>
                    <th>Oss. diversi</th>
                    <th>Ultimo</th>
                    <th>Progr.</th>
                    {coverage.matchdays.map((m) => (
                      <th key={m} style={{ whiteSpace: 'nowrap' }}>G{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleReferees.map((r) => (
                    <tr key={r.refereeId} className={r.active ? '' : 'is-disabled'}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.fullName}
                        {!r.active ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (inattivo)</span> : null}
                      </td>
                      <td style={{ fontWeight: 800, color: r.completedCount ? 'var(--blue)' : 'var(--muted-2)' }}>{r.completedCount}</td>
                      <td>{r.distinctObservers || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                        {formatDate(r.lastCompletedDate)}
                        {r.daysSinceLast !== null ? ` (${r.daysSinceLast} gg)` : ''}
                      </td>
                      <td>{r.scheduledCount || '—'}</td>
                      {coverage.matchdays.map((m) => {
                        const entries = r.timeline?.[m] || [];
                        return (
                          <td key={m} style={{ whiteSpace: 'nowrap' }}>
                            {entries.length === 0
                              ? '—'
                              : entries.map((entry, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    className="ghost-button"
                                    style={{
                                      padding: '1px 6px',
                                      fontSize: '0.75rem',
                                      fontStyle: entry.type === 'scheduled' ? 'italic' : 'normal',
                                      color: entry.type === 'scheduled' ? 'var(--muted)' : 'inherit'
                                    }}
                                    onClick={() =>
                                      entry.reportId ? navigate(`/reports/${entry.reportId}`) : entry.gameId ? navigate(`/games/${entry.gameId}`) : null
                                    }
                                    title={entry.type === 'scheduled' ? 'Programmato' : 'Completato'}
                                  >
                                    {entry.type === 'scheduled' ? '○' : '✓'} {entry.observerLabel}
                                  </button>
                                ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!loading && view === 'employment' && employment ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Impiego arbitri</h2>
              <p>Gare dirette nel campionato, dalle designazioni. Nelle colonne giornata: numero gara e ruolo.</p>
            </div>
          </div>
          {(() => {
            const visible = employment.referees.filter(matchesSearch);
            if (visible.length === 0) {
              return <div className="empty-state" style={{ padding: '24px' }}>Nessuna designazione in questa stagione.</div>;
            }
            return (
              <div style={{ overflowX: 'auto' }}>
                <table className="referee-table">
                  <thead>
                    <tr>
                      <th>Arbitro</th>
                      <th>Gare</th>
                      <th>Da 1°</th>
                      <th>Da 2°</th>
                      <th>Ultima</th>
                      {employment.matchdays.map((m) => (
                        <th key={m} style={{ whiteSpace: 'nowrap' }}>G{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.refereeId} className={r.active ? '' : 'is-disabled'}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ padding: '1px 6px', fontWeight: 600 }}
                            onClick={() => navigate(`/admin/referees/${r.refereeId}`)}
                          >
                            {r.fullName}
                          </button>
                          {!r.active ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (inattivo)</span> : null}
                        </td>
                        <td style={{ fontWeight: 800, color: r.totalGames ? 'var(--blue)' : 'var(--muted-2)' }}>{r.totalGames}</td>
                        <td>{r.asReferee1 || '—'}</td>
                        <td>{r.asReferee2 || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{formatDate(r.lastDate)}</td>
                        {employment.matchdays.map((m) => {
                          const entries = r.timeline?.[m] || [];
                          return (
                            <td key={m} style={{ whiteSpace: 'nowrap' }}>
                              {entries.length === 0
                                ? '—'
                                : entries.map((entry, i) => (
                                    <button
                                      key={i}
                                      type="button"
                                      className="ghost-button"
                                      style={{ padding: '1px 6px', fontSize: '0.75rem', fontFamily: 'monospace' }}
                                      onClick={() => navigate(`/games/${entry.gameId}`)}
                                      title={`${entry.teams} · ${formatDate(entry.date)}`}
                                    >
                                      {entry.matchNumber} ({entry.role === 'referee1' ? '1°' : entry.role === 'referee2' ? '2°' : '3°'})
                                    </button>
                                  ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </section>
      ) : null}

      {!loading && view === 'matrix' && matrix ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Matrice osservatore-arbitro</h2>
              <p>Numero di visionamenti completati (+ programmati tra parentesi). Clicca una cella per il dettaglio.</p>
            </div>
          </div>
          {matrix.observers.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}>Nessun visionamento in questa stagione.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="referee-table">
                <thead>
                  <tr>
                    <th>Osservatore \ Arbitro</th>
                    {matrix.referees.filter(matchesSearch).map((ref) => (
                      <th key={ref.refereeId} style={{ whiteSpace: 'nowrap' }}>{ref.fullName}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.observers.map((obs) => (
                    <tr key={obs.key}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {obs.label}
                        {obs.historical ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (storico)</span> : null}
                      </td>
                      {matrix.referees.filter(matchesSearch).map((ref) => {
                        const cell = cellsMap.get(`${obs.key}|${ref.refereeId}`);
                        const completed = cell?.completed || 0;
                        const scheduled = cell?.scheduled || 0;
                        return (
                          <td
                            key={ref.refereeId}
                            className={completed || scheduled ? 'is-clickable' : ''}
                            style={{ textAlign: 'center', ...cellStyle(completed) }}
                            onClick={() => (completed || scheduled ? openDetail(obs, ref) : null)}
                          >
                            {completed || scheduled ? `${completed}${scheduled ? ` (+${scheduled})` : ''}` : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detail ? (
            <div style={{ marginTop: '14px', borderTop: '1px solid var(--line-soft)', paddingTop: '12px' }}>
              <div className="section-heading">
                <div>
                  <h3>{detail.observer.label} → {detail.referee.fullName}</h3>
                </div>
                <button type="button" className="ghost-button" onClick={() => setDetail(null)}>Chiudi</button>
              </div>
              {detail.completed.length ? (
                <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                  {detail.completed.map((item, i) => (
                    <li key={i}>
                      ✓ {formatDate(item.date)} · gara {item.matchNumber} · {item.teams}{' '}
                      {item.reportId ? (
                        <button type="button" className="ghost-button" style={{ padding: '1px 8px' }} onClick={() => navigate(`/reports/${item.reportId}`)}>
                          Apri rapporto
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {detail.scheduled.length ? (
                <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px', marginTop: '6px' }}>
                  {detail.scheduled.map((item, i) => (
                    <li key={i} style={{ color: 'var(--muted)' }}>
                      ○ {formatDate(item.date)} · gara {item.matchNumber} · {item.teams}{' '}
                      {item.gameId ? (
                        <button type="button" className="ghost-button" style={{ padding: '1px 8px' }} onClick={() => navigate(`/games/${item.gameId}`)}>
                          Apri gara
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
