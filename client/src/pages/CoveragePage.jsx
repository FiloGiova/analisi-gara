import { useEffect, useState } from 'react';
import { COMPETITIONS, currentSportSeason } from '../../../shared/reportTemplate.js';
import MultiSelect from '../components/MultiSelect.jsx';
import Select from '../components/Select.jsx';
import { api, ApiError, downloadStatsExport } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatMatchNumber } from '../lib/formatters.js';

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

function refereeRoleLabel(role) {
  if (role === 'referee1') return '1°';
  if (role === 'referee2') return '2°';
  return '3°';
}

function compareSortValues(first, second) {
  if (typeof first === 'number' && typeof second === 'number') return first - second;
  return String(first || '').localeCompare(String(second || ''), 'it', {
    sensitivity: 'base',
    numeric: true
  });
}

function sortRows(rows, sort, valueFor) {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((first, second) => {
    const compared = compareSortValues(valueFor(first, sort.key), valueFor(second, sort.key));
    if (compared) return compared * direction;
    return String(first.fullName || first.label || '').localeCompare(
      String(second.fullName || second.label || ''),
      'it',
      { sensitivity: 'base' }
    );
  });
}

function updateSort(setSort, key, initialDirection = 'asc') {
  setSort((current) => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: initialDirection });
}

function SortableHeader({ label, sort, sortKey, onSort, initialDirection = 'asc', style, className = '' }) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th aria-sort={ariaSort} style={style} className={className}>
      <button type="button" className="sortable-header-button" onClick={() => onSort(sortKey, initialDirection)}>
        <span>{label}</span>
        <span className={`sort-indicator ${active ? 'is-active' : ''}`} aria-hidden="true">
          {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

export default function CoveragePage({ currentUser, globalSeason, seasons }) {
  const canAccess = currentUser.role === 'admin' || currentUser.role === 'instructor';
  const [view, setView] = useState('coverage');
  const [season, setSeason] = useState(globalSeason);
  const [competition, setCompetition] = useState(''); // '' = tutti i campionati
  const [phaseIds, setPhaseIds] = useState([]); // sorgenti FIP/fasi selezionate (checkbox)
  const [phaseOptions, setPhaseOptions] = useState([]);
  const [band, setBand] = useState(''); // '' = tutte le fasce
  const [search, setSearch] = useState(''); // filtro nome/cognome/tessera
  const [coverage, setCoverage] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [employment, setEmployment] = useState(null);
  const [detail, setDetail] = useState(null);
  const [coverageSort, setCoverageSort] = useState({ key: 'name', direction: 'asc' });
  const [employmentSort, setEmploymentSort] = useState({ key: 'name', direction: 'asc' });
  const [matrixSort, setMatrixSort] = useState({ key: 'observer', direction: 'asc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setSeason(globalSeason);
    setPhaseIds([]);
  }, [globalSeason]);

  useEffect(() => {
    if (!canAccess) return;
    setLoading(true);
    setError('');
    setDetail(null);
    Promise.all([
      api.getStatsPhases({ season, competition }),
      api.getCoverage({ season, competition, band, phaseIds }),
      api.getMatrix({ season, competition, band, phaseIds }),
      api.getEmployment({ season, competition, band, phaseIds })
    ])
      .then(([phaseData, cov, mat, emp]) => {
        setPhaseOptions(phaseData.phases || []);
        setCoverage(cov);
        setMatrix(mat);
        setEmployment(emp);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossibile caricare i visionamenti.'))
      .finally(() => setLoading(false));
  }, [canAccess, season, competition, phaseIds, band]);

  if (!canAccess) {
    return <div className="empty-state"><h2>Sezione riservata ad amministratori e formatori</h2></div>;
  }

  async function openDetail(observer, referee) {
    try {
      const data = await api.getMatrixDetail({
        season,
        competition,
        phaseIds,
        observerKey: observer.key,
        refereeId: referee.refereeId
      });
      setDetail({ observer, referee, ...data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Dettaglio non disponibile.');
    }
  }

  function handleExport() {
    const sort = view === 'coverage'
      ? coverageSort
      : view === 'employment'
        ? employmentSort
        : matrixSort;
    downloadStatsExport({
      view,
      season,
      competition,
      band,
      phaseIds,
      search,
      sortKey: sort.key,
      sortDirection: sort.direction
    });
  }

  const searchQuery = search.trim().toLowerCase();
  function matchesSearch(ref) {
    if (!searchQuery) return true;
    return (ref.fullName || '').toLowerCase().includes(searchQuery) || (ref.license || '').toLowerCase().includes(searchQuery);
  }

  const cellsMap = new Map((matrix?.cells || []).map((c) => [`${c.observerKey}|${c.refereeId}`, c]));
  const visibleReferees = (coverage?.referees || []).filter(matchesSearch);
  const sortedCoverageReferees = sortRows(visibleReferees, coverageSort, (row, key) => {
    if (key.startsWith('matchday:')) {
      const matchday = key.replace('matchday:', '');
      return row.timeline?.[matchday]?.length || 0;
    }
    return ({
      name: row.fullName,
      completed: row.completedCount || 0,
      last: row.lastCompletedDate ? new Date(row.lastCompletedDate).getTime() : 0
    })[key];
  });
  const visibleMatrixReferees = (matrix?.referees || []).filter(matchesSearch);
  const sortedMatrixObservers = sortRows(matrix?.observers || [], matrixSort, (observer, key) => {
    if (key === 'observer') return observer.label;
    const refereeId = Number(key.replace('referee:', ''));
    const cell = cellsMap.get(`${observer.key}|${refereeId}`);
    return (cell?.completed || 0) * 1000 + (cell?.scheduled || 0);
  });

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
          <button type="button" className="ghost-button" onClick={handleExport} disabled={loading}>
            Esporta vista XLSX
          </button>
        </div>
        <div className="games-filters-row" style={{ marginTop: '12px' }}>
          <div style={{ flex: '0 1 220px' }}>
            <Select
              value={season}
              onChange={(value) => { setSeason(value); setPhaseIds([]); }}
              placeholder="Stagione statistiche"
              options={seasons.map((item) => ({
                value: item,
                label: item === CURRENT_SEASON ? `${item} · corrente` : `${item} · archivio`
              }))}
            />
            <small style={{ display: 'block', margin: '5px 2px 0', color: 'var(--muted)' }}>
              Vale solo in questa pagina
            </small>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca arbitro: nome, cognome o tessera…"
            style={{ flex: '0 1 340px', minHeight: '46px', boxSizing: 'border-box' }}
          />
          <div style={{ flex: '0 1 240px' }}>
            <Select
              value={competition}
              onChange={(value) => { setCompetition(value); setPhaseIds([]); }}
              placeholder="Tutti i campionati"
              options={competitionSelectOptions}
            />
          </div>
          <div className="games-filter-fase">
            <MultiSelect
              values={phaseIds}
              onChange={setPhaseIds}
              allLabel={phaseOptions.length ? 'Tutte le fasi' : 'Nessuna fase disponibile'}
              options={phaseOptions.map((item) => ({
                value: String(item.id),
                label: competition || !item.competition ? item.name : `${item.name} · ${item.competition}`
              }))}
              disabled={!phaseOptions.length}
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
                    <SortableHeader label="Arbitro" sort={coverageSort} sortKey="name" onSort={(key, direction) => updateSort(setCoverageSort, key, direction)} />
                    <SortableHeader label="Compl." sort={coverageSort} sortKey="completed" initialDirection="desc" onSort={(key, direction) => updateSort(setCoverageSort, key, direction)} />
                    <SortableHeader label="Ultimo" sort={coverageSort} sortKey="last" initialDirection="desc" onSort={(key, direction) => updateSort(setCoverageSort, key, direction)} />
                    {coverage.matchdays.map((m) => (
                      <SortableHeader
                        key={m}
                        label={`G${m}`}
                        sort={coverageSort}
                        sortKey={`matchday:${m}`}
                        initialDirection="desc"
                        onSort={(key, direction) => updateSort(setCoverageSort, key, direction)}
                        style={{ whiteSpace: 'nowrap' }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCoverageReferees.map((r) => (
                    <tr key={r.refereeId}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.fullName}
                      </td>
                      <td style={{ fontWeight: 800, color: r.completedCount ? 'var(--blue)' : 'var(--muted-2)' }}>{r.completedCount}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                        {formatDate(r.lastCompletedDate)}
                        {r.daysSinceLast !== null ? ` (${r.daysSinceLast} gg)` : ''}
                      </td>
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
              <p>Gare dirette nel campionato, dalle designazioni. Nelle colonne giornata: squadre e ruolo.</p>
            </div>
          </div>
          {(() => {
            const visible = sortRows(employment.referees.filter(matchesSearch), employmentSort, (row, key) => {
              if (key.startsWith('matchday:')) {
                const matchday = key.replace('matchday:', '');
                return row.timeline?.[matchday]?.length || 0;
              }
              return ({
                name: row.fullName,
                games: row.totalGames || 0,
                last: row.lastDate ? new Date(row.lastDate).getTime() : 0
              })[key];
            });
            if (visible.length === 0) {
              return <div className="empty-state" style={{ padding: '24px' }}>Nessuna designazione in questa stagione.</div>;
            }
            return (
              <div className="stats-table-scroll">
                <table className="referee-table stats-employment-table">
                  <thead>
                    <tr>
                      <SortableHeader
                        label="Arbitro"
                        sort={employmentSort}
                        sortKey="name"
                        onSort={(key, direction) => updateSort(setEmploymentSort, key, direction)}
                        className="stats-sticky-column"
                      />
                      <SortableHeader label="Gare" sort={employmentSort} sortKey="games" initialDirection="desc" onSort={(key, direction) => updateSort(setEmploymentSort, key, direction)} />
                      <SortableHeader label="Ultima" sort={employmentSort} sortKey="last" initialDirection="desc" onSort={(key, direction) => updateSort(setEmploymentSort, key, direction)} />
                      {employment.matchdays.map((m) => (
                        <SortableHeader
                          key={m}
                          label={`G${m}`}
                          sort={employmentSort}
                          sortKey={`matchday:${m}`}
                          initialDirection="desc"
                          onSort={(key, direction) => updateSort(setEmploymentSort, key, direction)}
                          style={{ whiteSpace: 'nowrap' }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.refereeId}>
                        <td className="stats-sticky-column" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ padding: '1px 6px', fontWeight: 600 }}
                            onClick={() => navigate(`/admin/referees/${r.refereeId}`)}
                          >
                            {r.fullName}
                          </button>
                        </td>
                        <td style={{ fontWeight: 800, color: r.totalGames ? 'var(--blue)' : 'var(--muted-2)' }}>{r.totalGames}</td>
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
                                      className="employment-matchup-button"
                                      onClick={() => navigate(`/games/${entry.gameId}`)}
                                      title={`Gara ${formatMatchNumber(entry.matchNumber)} · ${entry.teams} · ${formatDate(entry.date)}`}
                                    >
                                      <span className="employment-matchup-teams">
                                        <span>{entry.teamHome || '—'}</span>
                                        <span><small>vs</small> {entry.teamAway || '—'}</span>
                                      </span>
                                      <span className="employment-matchup-role">{refereeRoleLabel(entry.role)}</span>
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
                    <SortableHeader label="Osservatore \ Arbitro" sort={matrixSort} sortKey="observer" onSort={(key, direction) => updateSort(setMatrixSort, key, direction)} />
                    {visibleMatrixReferees.map((ref) => (
                      <SortableHeader
                        key={ref.refereeId}
                        label={ref.fullName}
                        sort={matrixSort}
                        sortKey={`referee:${ref.refereeId}`}
                        initialDirection="desc"
                        onSort={(key, direction) => updateSort(setMatrixSort, key, direction)}
                        style={{ whiteSpace: 'nowrap' }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedMatrixObservers.map((obs) => (
                    <tr key={obs.key}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {obs.label}
                        {obs.historical ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (storico)</span> : null}
                      </td>
                      {visibleMatrixReferees.map((ref) => {
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
                      ✓ {formatDate(item.date)} · gara {formatMatchNumber(item.matchNumber)} · {item.teams}{' '}
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
                      ○ {formatDate(item.date)} · gara {formatMatchNumber(item.matchNumber)} · {item.teams}{' '}
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
