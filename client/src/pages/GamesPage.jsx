import { Fragment, useEffect, useMemo, useState } from 'react';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import { useCompetitions } from '../lib/competitions.jsx';
import Select from '../components/Select.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import FilterBar from '../components/FilterBar.jsx';
import GameStateBadge from '../components/GameStateBadge.jsx';
import { api, ApiError, downloadGamesExport } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatMatchNumber, formatDateTime } from '../lib/formatters.js';
import { instructorCompetitionsForSeason } from '../../../shared/instructorAssignments.js';
import ListSkeleton from '../components/ListSkeleton.jsx';
import PeriodFilter from '../components/PeriodFilter.jsx';
import ReportTypeBadge from '../components/ReportTypeBadge.jsx';
import { gameDateKey, isGameInPeriod, todayIso, formatPeriodLabel } from '../../../shared/gamePeriod.js';
import { can, isScopedOnly } from '../../../shared/permissions.js';

const CURRENT_SEASON = currentSportSeason();

const EMPTY_FORM = {
  matchNumber: '',
  competition: '',
  matchday: '',
  scheduledDate: '',
  scheduledTime: '',
  teamHome: '',
  teamAway: '',
  venue: ''
};

function officialLabel(official) {
  if (!official) return '—';
  return official.refereeName || official.userName || official.externalName || '—';
}

// Righe-separatore dell'elenco: si vede subito dove comincia ogni giornata
// mentre si scorre, anche aprendo la pagina a metà stagione.
function matchdayGroupKey(game) {
  return game ? `${game.sourceName || ''}|${game.matchday ?? ''}` : null;
}

function matchdayHeaderFor(games, index) {
  const game = games[index];
  if (index > 0 && matchdayGroupKey(games[index - 1]) === matchdayGroupKey(game)) return null;

  let end = index;
  while (end + 1 < games.length && matchdayGroupKey(games[end + 1]) === matchdayGroupKey(game)) end += 1;
  const dates = games.slice(index, end + 1).map((item) => gameDateKey(item)).filter(Boolean).sort();
  const range = dates.length ? formatPeriodLabel(dates[0], dates[dates.length - 1]) : '';

  return (
    <tr className="matchday-row">
      <td colSpan={9}>
        {game.matchday ? `Giornata ${game.matchday}` : 'Senza giornata'}
        {game.sourceName ? ` · ${game.sourceName}` : ''}
        {range ? <span className="matchday-row-dates">{range}</span> : null}
      </td>
    </tr>
  );
}

export default function GamesPage({ currentUser, season }) {
  const { activeCompetitions, competitionLabel } = useCompetitions();
  const assignedCompetitions = instructorCompetitionsForSeason(currentUser, season);
  // Gare: le gestisce chi le crea/modifica (admin, operatore, formatore) e
  // chi designa; l'elenco serve a entrambi.
  const canManage = can(currentUser, 'games:manage') || can(currentUser, 'designations:assign');
  const [games, setGames] = useState([]);
  const [matchday, setMatchday] = useState('');
  const [competition, setCompetition] = useState('');
  const [sourceFilter, setSourceFilter] = useState([]); // fasi selezionate (menu a tendina multi)
  const [refereeFilter, setRefereeFilter] = useState('');
  const [search, setSearch] = useState('');
  // Il periodo apre l'elenco sulla giornata in corso invece che sulla prima di
  // ottobre; l'ultimo scelto resta per la sessione (tornare dal dettaglio gara
  // non deve riportare al default).
  const [period, setPeriod] = useState(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('games-period') || 'null');
      if (stored && (stored.from !== undefined)) return stored;
    } catch (_) { /* sessionStorage non disponibile: si usa il default */ }
    return { from: todayIso(), to: '' };
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    setMatchday('');
    setCompetition('');
    setSourceFilter([]);
    setRefereeFilter('');
    setForm(EMPTY_FORM);
    setShowForm(false);
    if (canManage) loadGames();
  }, [canManage, season]);

  useEffect(() => {
    try {
      sessionStorage.setItem('games-period', JSON.stringify(period));
    } catch (_) { /* niente sessionStorage: il periodo vale solo per questa pagina */ }
  }, [period.from, period.to]);

  // Il filtro campionato si mostra solo a chi ha davvero una scelta da fare:
  // l'admin e il formatore assegnato a più di un campionato. Con un campionato
  // solo sarebbe una tendina con una voce sola.
  const competitionOptions = useMemo(() => {
    if (currentUser.role === 'instructor') return assignedCompetitions;
    const present = Array.from(new Set(games.map((game) => game.competition).filter(Boolean))).sort();
    return present.length ? present : activeCompetitions.map((item) => item.value);
  }, [assignedCompetitions.join('|'), currentUser.role, games, activeCompetitions]);

  const showCompetitionFilter = !isScopedOnly(currentUser, 'games:manage') || competitionOptions.length > 1;

  // Gli altri filtri si restringono al campionato scelto: fasi, giornate e
  // arbitri di un altro campionato non servono a nessuno.
  const gamesInCompetition = useMemo(
    () => (competition ? games.filter((game) => game.competition === competition) : games),
    [games, competition]
  );

  const matchdays = useMemo(
    () => Array.from(new Set(gamesInCompetition.map((g) => g.matchday).filter((m) => m !== null))).sort((a, b) => a - b),
    [gamesInCompetition]
  );

  const refereeOptions = useMemo(() => {
    const map = new Map();
    for (const game of gamesInCompetition) {
      for (const role of ['referee1', 'referee2', 'referee3']) {
        const official = game.officials[role];
        if (official?.refereeId) {
          map.set(official.refereeId, official.refereeName || official.externalName);
        }
      }
    }
    return [...map.entries()]
      .map(([id, label]) => ({ value: String(id), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [gamesInCompetition]);

  const sourceOptions = useMemo(
    () => Array.from(new Set(gamesInCompetition.map((g) => g.sourceName).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [gamesInCompetition]
  );

  const daysWithGames = useMemo(
    () => Array.from(new Set(gamesInCompetition.map((game) => gameDateKey(game)).filter(Boolean))),
    [gamesInCompetition]
  );

  const matchesFilters = (game, { ignorePeriod = false } = {}) => {
    if (!ignorePeriod && !isGameInPeriod(game, period.from, period.to)) return false;
    if (competition && game.competition !== competition) return false;
    if (matchday && String(game.matchday) !== matchday) return false;
    if (sourceFilter.length && !sourceFilter.includes(game.sourceName)) return false;
    if (refereeFilter) {
      const refereeId = Number(refereeFilter);
      const hasReferee = ['referee1', 'referee2', 'referee3'].some(
        (role) => game.officials[role]?.refereeId === refereeId
      );
      if (!hasReferee) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        game.matchNumber,
        game.teamHome,
        game.teamAway,
        officialLabel(game.officials.referee1),
        officialLabel(game.officials.referee2),
        officialLabel(game.officials.observer)
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  };

  // Con un periodo attivo l'ordine è cronologico: chi filtra "questo weekend"
  // si aspetta le gare in ordine di data, anche quelle rinviate da altre giornate.
  const hasPeriod = Boolean(period.from || period.to);
  const filtered = games
    .filter((game) => matchesFilters(game))
    .sort((first, second) => (hasPeriod
      ? String(first.scheduledAt || '').localeCompare(String(second.scheduledAt || ''))
      : 0));

  // Quante gare troverebbe la stessa ricerca senza limiti di periodo: serve
  // all'uscita di sicurezza dell'empty state.
  const outsidePeriodCount = hasPeriod
    ? games.filter((game) => matchesFilters(game, { ignorePeriod: true })).length
    : 0;

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleExport() {
    downloadGamesExport({
      season,
      matchday,
      competition,
      sourceNames: sourceFilter,
      refereeId: refereeFilter,
      search,
      dateFrom: period.from,
      dateTo: period.to
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const scheduledAt = form.scheduledDate
        ? form.scheduledTime
          ? `${form.scheduledDate}T${form.scheduledTime}`
          : form.scheduledDate
        : '';
      await api.createGame({
        sportSeason: season,
        matchNumber: form.matchNumber,
        competition: form.competition,
        matchday: form.matchday,
        scheduledAt,
        teamHome: form.teamHome,
        teamAway: form.teamAway,
        venue: form.venue
      });
      setSuccess(`Gara ${formatMatchNumber(form.matchNumber)} creata.`);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadGames();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Creazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="empty-state">
        <h2>{currentUser.role === 'instructor' ? `Nessun campionato assegnato per la stagione ${season}` : 'Sezione riservata ad amministratori e formatori'}</h2>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">{season === CURRENT_SEASON ? 'Stagione corrente' : `Archivio ${season}`}</p>
          <h1>Gare e designazioni</h1>
          <p>
            Calendario, arbitri e osservatori in un unico posto. Le gare senza osservatore sono
            normali gare scoperte, evidenziate per facilitare le assegnazioni.
          </p>
        </div>
        {canManage ? (
          <div className="hero-actions">
            <button type="button" className="ghost-button" onClick={() => navigate('/observers')}>
              Indisponibilità
            </button>
            <button type="button" className="ghost-button" onClick={() => navigate('/games/designate')}>
              Designa osservatori
            </button>
            {!showForm ? (
              <button type="button" className="primary-button" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }}>
                + Nuova gara
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      {showForm ? (
        <form className="common-card" onSubmit={handleCreate}>
          <div className="section-heading">
            <div>
              <h2>Nuova gara (inserimento manuale)</h2>
              <p>La gara viene creata nella stagione {season}. Arbitri e osservatore si assegnano dal dettaglio.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annulla</button>
          </div>
          <div className="common-grid">
            <label className="field field-span-2">
              <span className="required-label">Numero gara <small className="required-symbol">*</small></span>
              <input value={form.matchNumber} onChange={(e) => updateForm('matchNumber', e.target.value)} placeholder="es. 311" required />
            </label>
            <label className="field field-span-2">
              Campionato
              <Select
                value={form.competition}
                onChange={(v) => updateForm('competition', v)}
                placeholder="— Seleziona —"
                options={activeCompetitions
                  .filter((competition) => currentUser.role !== 'instructor' || assignedCompetitions.includes(competition.value))
                  .map((c) => ({ value: c.value, label: c.label }))}
              />
            </label>
            <label className="field field-span-2">
              Giornata
              <input inputMode="numeric" value={form.matchday} onChange={(e) => updateForm('matchday', e.target.value)} placeholder="es. 5" />
            </label>
            <label className="field field-span-2">
              Data
              <input type="date" value={form.scheduledDate} onChange={(e) => updateForm('scheduledDate', e.target.value)} />
            </label>
            <label className="field field-span-2">
              Ora
              <input type="time" value={form.scheduledTime} onChange={(e) => updateForm('scheduledTime', e.target.value)} />
            </label>
            <label className="field field-span-2">
              Campo
              <input value={form.venue} onChange={(e) => updateForm('venue', e.target.value)} />
            </label>
            <label className="field field-span-3">
              <span className="required-label">Squadra casa <small className="required-symbol">*</small></span>
              <input value={form.teamHome} onChange={(e) => updateForm('teamHome', e.target.value)} required />
            </label>
            <label className="field field-span-3">
              <span className="required-label">Squadra ospite <small className="required-symbol">*</small></span>
              <input value={form.teamAway} onChange={(e) => updateForm('teamAway', e.target.value)} required />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annulla</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Creazione...' : 'Crea gara'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Elenco gare{filtered.length !== games.length ? ` (${filtered.length} di ${games.length})` : ` (${games.length})`}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={handleExport} disabled={loading}>
            Esporta vista XLSX
          </button>
        </div>

        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'Cerca per numero gara, squadra, arbitro, osservatore…'
          }}
          activeCount={
            (competition ? 1 : 0) +
            (sourceFilter.length ? 1 : 0) +
            (matchday ? 1 : 0) +
            (refereeFilter ? 1 : 0) +
            (hasPeriod ? 1 : 0)
          }
          onReset={() => {
            setCompetition('');
            setSourceFilter([]);
            setMatchday('');
            setRefereeFilter('');
            setPeriod({ from: '', to: '' });
          }}
        >
          <PeriodFilter
            from={period.from}
            to={period.to}
            onChange={setPeriod}
            daysWithGames={daysWithGames}
          />
          {showCompetitionFilter ? (
            <Select
              value={competition}
              onChange={(value) => { setCompetition(value); setSourceFilter([]); }}
              placeholder="Campionato"
              placeholderOnEmpty
              options={[
                { value: '', label: 'Tutti i campionati' },
                ...competitionOptions.map((value) => ({ value, label: competitionLabel(value) }))
              ]}
            />
          ) : null}
          {sourceOptions.length ? (
            <MultiSelect
              values={sourceFilter}
              onChange={setSourceFilter}
              allLabel="Fase"
              options={sourceOptions.map((s) => ({ value: s, label: s }))}
            />
          ) : null}
          <Select
            value={matchday}
            onChange={setMatchday}
            placeholder="Giornata"
            placeholderOnEmpty
            options={[{ value: '', label: 'Tutte le giornate' }, ...matchdays.map((m) => ({ value: String(m), label: `Giornata ${m}` }))]}
          />
          {refereeOptions.length ? (
            <Select
              value={refereeFilter}
              onChange={setRefereeFilter}
              placeholder="Arbitro"
              placeholderOnEmpty
              options={[{ value: '', label: 'Tutti gli arbitri' }, ...refereeOptions]}
              searchable
            />
          ) : null}
        </FilterBar>

        {loading ? <ListSkeleton rows={6} /> : null}

        {!loading && filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
            {games.length === 0
              ? 'Nessuna gara in questa stagione. Configura una sorgente FIP (menu Admin → Sorgenti gare) oppure crea una gara manualmente.'
              : `Nessuna gara corrisponde ai filtri${hasPeriod ? ` nel periodo ${formatPeriodLabel(period.from, period.to)}` : ''}.`}
            {outsidePeriodCount > 0 ? (
              <div style={{ marginTop: '12px' }}>
                <button type="button" className="primary-button" onClick={() => setPeriod({ from: '', to: '' })}>
                  Cerca in tutta la stagione ({outsidePeriodCount})
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading && filtered.length > 0 ? (
          <div className="table-scroll">
            <table className="referee-table">
              <thead>
                <tr>
                  <th>N. gara</th>
                  <th>Giorn.</th>
                  <th>Data</th>
                  <th>Fase</th>
                  <th>Incontro</th>
                  <th>1° arbitro</th>
                  <th>2° arbitro</th>
                  <th>Osservatore</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((game, index) => (
                  <Fragment key={game.id}>
                    {matchdayHeaderFor(filtered, index)}
                  <tr className="is-clickable" onClick={() => navigate(`/games/${game.id}`)}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{formatMatchNumber(game.matchNumber)}</td>
                    <td style={{ color: 'var(--muted)' }}>{game.matchday ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{formatDateTime(game.scheduledAt)}</td>
                    <td style={{ color: 'var(--muted)' }}>{game.sourceName || '—'}</td>
                    <td style={{ fontWeight: 600 }}>
                      {game.teamHome} - {game.teamAway}
                      {game.scoreHome !== '' && game.scoreAway !== '' ? (
                        <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({game.scoreHome}-{game.scoreAway})</span>
                      ) : null}
                    </td>
                    <td>{officialLabel(game.officials.referee1)}</td>
                    <td>{officialLabel(game.officials.referee2)}</td>
                    <td style={{ fontWeight: game.officials.observer ? 600 : 400, color: game.officials.observer ? 'inherit' : 'var(--muted)' }}>
                      {officialLabel(game.officials.observer)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <GameStateBadge state={game.derivedState} />
                        <ReportTypeBadge type={game.reportType} />
                        {game.needsAlias ? (
                          <span className="status-badge status-badge-sm status-cancelled">
                            Nomi da associare
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
