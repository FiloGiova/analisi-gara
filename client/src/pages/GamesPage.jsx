import { useEffect, useMemo, useState } from 'react';
import { COMPETITIONS, currentSportSeason } from '../../../shared/reportTemplate.js';
import Select from '../components/Select.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import GameStateBadge from '../components/GameStateBadge.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatMatchNumber } from '../lib/formatters.js';

const CURRENT_SEASON = currentSportSeason();

// Filtri stato "operativi": solo le tre situazioni da lavorare.
const STATE_FILTERS = [
  { value: 'arbitri_mancanti', label: 'Arbitri da designare' },
  { value: 'scoperta', label: 'Scoperta' },
  { value: 'rapporto_mancante', label: 'Rapporto mancante' }
];

// A quali categorie appartiene una gara (una gara può ricadere in più di una).
// Rinviate/annullate non sono situazioni da lavorare: nessuna categoria.
function gameStateCategories(game) {
  if (game.status === 'postponed' || game.status === 'cancelled') return [];
  const hasReferees = Boolean(game.officials.referee1) && Boolean(game.officials.referee2);
  const hasObserver = Boolean(game.officials.observer);
  const reportFinal = game.reportStatus === 'final';
  const cats = [];
  if (!hasReferees) cats.push('arbitri_mancanti');
  if (hasReferees && !hasObserver) cats.push('scoperta');
  if (hasObserver && !reportFinal) cats.push('rapporto_mancante');
  return cats;
}

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

function officialLabel(official) {
  if (!official) return '—';
  return official.refereeName || official.userName || official.externalName || '—';
}

export default function GamesPage({ currentUser, season }) {
  const canManage = currentUser.role === 'admin' || currentUser.role === 'instructor';
  const [games, setGames] = useState([]);
  const [matchday, setMatchday] = useState('');
  const [stateFilter, setStateFilter] = useState([]); // più stati selezionabili insieme (checkbox)
  const [sourceFilter, setSourceFilter] = useState([]); // fasi selezionate (menu a tendina multi)
  const [refereeFilter, setRefereeFilter] = useState('');
  const [search, setSearch] = useState('');
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
    setStateFilter([]);
    setSourceFilter([]);
    setRefereeFilter('');
    if (canManage) loadGames();
  }, [season]);

  const matchdays = useMemo(
    () => Array.from(new Set(games.map((g) => g.matchday).filter((m) => m !== null))).sort((a, b) => a - b),
    [games]
  );

  const refereeOptions = useMemo(() => {
    const map = new Map();
    for (const game of games) {
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
  }, [games]);

  const sourceOptions = useMemo(
    () => Array.from(new Set(games.map((g) => g.sourceName).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [games]
  );

  const filtered = games.filter((game) => {
    if (matchday && String(game.matchday) !== matchday) return false;
    if (stateFilter.length) {
      const cats = gameStateCategories(game);
      if (!stateFilter.some((s) => cats.includes(s))) return false;
    }
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
  });

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
    return <div className="empty-state"><h2>Sezione riservata ad amministratori e formatori</h2></div>;
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
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="ghost-button" onClick={() => navigate('/games/designate')}>
              Designa osservatori
            </button>
            {!showForm ? (
              <button type="button" className="hero-button" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }}>
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
                options={COMPETITIONS.map((c) => ({ value: c.value, label: c.label }))}
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
        </div>

        <div className="games-filters-search">
          <input
            className="games-filter-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per numero gara, squadra, arbitro, osservatore…"
          />
        </div>

        <div className="games-filters-row">
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
          <div className="games-filter-giornata">
            <Select
              value={matchday}
              onChange={setMatchday}
              placeholder="Tutte le giornate"
              options={[{ value: '', label: 'Tutte le giornate' }, ...matchdays.map((m) => ({ value: String(m), label: `Giornata ${m}` }))]}
            />
          </div>
          {refereeOptions.length ? (
            <div className="games-filter-arbitro">
              <Select
                value={refereeFilter}
                onChange={setRefereeFilter}
                placeholder="Tutti gli arbitri"
                options={[{ value: '', label: 'Tutti gli arbitri' }, ...refereeOptions]}
                searchable
              />
            </div>
          ) : null}
          <div className="games-filter-stato">
            <MultiSelect
              values={stateFilter}
              onChange={setStateFilter}
              allLabel="Tutti gli stati"
              options={STATE_FILTERS}
            />
          </div>
        </div>

        {loading ? <div className="empty-state" style={{ padding: '24px' }}>Caricamento...</div> : null}

        {!loading && filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
            {games.length === 0
              ? 'Nessuna gara in questa stagione. Configura una sorgente FIP (menu Admin → Sorgenti gare) oppure crea una gara manualmente.'
              : 'Nessuna gara corrisponde ai filtri.'}
          </div>
        ) : null}

        {!loading && filtered.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
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
                {filtered.map((game) => (
                  <tr key={game.id} className="is-clickable" onClick={() => navigate(`/games/${game.id}`)}>
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
                        {game.needsAlias ? (
                          <span className="status-badge" style={{ background: 'var(--paper-2)', color: 'var(--danger)', padding: '3px 8px', fontSize: '0.72rem' }}>
                            Nomi da associare
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
