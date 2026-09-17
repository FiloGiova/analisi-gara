import { useEffect, useState } from 'react';
import { formatDate } from '../lib/formatters.js';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import {
  REFEREE_STATUS_OPTIONS,
  isActiveStatus,
  refereeStatusLabel,
  refereeStatusTone
} from '../../../shared/refereeStatus.js';
import { useCompetitions } from '../lib/competitions.jsx';
import DateInput from '../components/DateInput.jsx';
import Select from '../components/Select.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import FilterBar from '../components/FilterBar.jsx';
import ColumnsMenu from '../components/ColumnsMenu.jsx';
import { api, ApiError, downloadRefereeRankingExport, downloadRefereesExport } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { instructorCompetitionsForSeason } from '../../../shared/instructorAssignments.js';
import ListSkeleton from '../components/ListSkeleton.jsx';
import { can, hasRole } from '../../../shared/permissions.js';

const CURRENT_SEASON = currentSportSeason();

const EMPTY_FORM = {
  licenseNumber: '',
  firstName: '',
  lastName: '',
  birthDate: '',
  email: '',
  phone: '',
  province: '',
  certificateExpiry: '',
  category: '',
  notes: ''
};

const BAND_OPTIONS = [
  { value: 'esordiente', label: 'Esordienti' },
  { value: 'playoff', label: 'Playoff' },
  { value: 'playout', label: 'Playout' }
];

// Colonne dell'elenco: "Cognome, Nome" è obbligatoria e resta fuori dal menu.
const LIST_COLUMNS = [
  { key: 'license', label: 'Tessera' },
  { key: 'name', label: 'Cognome, Nome', required: true },
  { key: 'province', label: 'Provincia' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Telefono' },
  { key: 'certificate', label: 'Scadenza certificato' },
  { key: 'category', label: 'Categoria' },
  { key: 'status', label: 'Stato' },
  { key: 'notes', label: 'Note' }
];

const OPTIONAL_COLUMN_KEYS = LIST_COLUMNS.filter((column) => !column.required).map((column) => column.key);
const COLUMNS_STORAGE_KEY = 'fischiolab.referees.columns';

// La scelta resta sul dispositivo: è una preferenza di lettura, non un dato.
function loadVisibleColumns() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLUMNS_STORAGE_KEY) || 'null');
    if (!Array.isArray(stored)) return OPTIONAL_COLUMN_KEYS;
    return OPTIONAL_COLUMN_KEYS.filter((key) => stored.includes(key));
  } catch {
    return OPTIONAL_COLUMN_KEYS;
  }
}

function isExpiringSoon(iso) {
  if (!iso) return false;
  return (new Date(iso) - new Date()) < 90 * 86400 * 1000;
}

function seasonTitle(season) {
  return season === CURRENT_SEASON ? 'Anagrafica arbitri' : `Archivio arbitri ${season}`;
}

function statusForSeason(referee, season) {
  return season === CURRENT_SEASON ? referee.status : referee.seasonStatus;
}

export default function AdminRefereesPage({ currentUser, season: selectedSeason }) {
  const { activeCompetitions, competitionLabel } = useCompetitions();
  const assignedCompetitions = instructorCompetitionsForSeason(currentUser, selectedSeason);
  const canAccess = can(currentUser, 'referees:inspect');
  const [referees, setReferees] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBand, setFilterBand] = useState(''); // filtro fascia nell'elenco
  const [visibleColumns, setVisibleColumns] = useState(loadVisibleColumns);
  const [allBands, setAllBands] = useState([]); // tutte le appartenenze fascia della stagione
  // Vista Fasce
  const bandCompetitions = assignedCompetitions.length ? assignedCompetitions : activeCompetitions.map((c) => c.value);
  const [bandCompetition, setBandCompetition] = useState(bandCompetitions[0] || '');
  const [bandFilter, setBandFilter] = useState('esordiente');
  const [bandMembers, setBandMembers] = useState([]);
  const [bandPool, setBandPool] = useState([]);
  const [bandAddIds, setBandAddIds] = useState([]); // selezione multipla per inserimento in blocco
  const [bandBusy, setBandBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formBands, setFormBands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      // Preferenza non persistita: la vista resta comunque corretta.
    }
  }, [visibleColumns]);

  useEffect(() => {
    if (!bandCompetitions.includes(bandCompetition)) {
      setBandCompetition(bandCompetitions[0] || '');
    }
  }, [bandCompetition, bandCompetitions.join('|')]);

  async function loadReferees(season = selectedSeason) {
    setLoading(true);
    try {
      const data = await api.listReferees({ season });
      setReferees(data.referees);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare gli arbitri.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRanking(season = selectedSeason) {
    try {
      const data = await api.getRefereeRanking({ season });
      setRanking(data.ranking || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare la classifica.');
    }
  }

  async function loadAllBands() {
    try {
      const data = await api.listRefereeBands({ season: selectedSeason });
      setAllBands(data.members || []);
    } catch {
      setAllBands([]);
    }
  }

  async function loadBands() {
    if (!bandCompetition || !bandFilter) { setBandMembers([]); setBandPool([]); return; }
    try {
      const [membersRes, poolRes] = await Promise.all([
        api.listRefereeBands({ competition: bandCompetition, season: selectedSeason, band: bandFilter }),
        api.listReferees({ competition: bandCompetition, season: selectedSeason })
      ]);
      setBandMembers(membersRes.members || []);
      setBandPool(poolRes.referees || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare le fasce.');
    }
  }

  async function addBand() {
    if (!bandAddIds.length) return;
    setBandBusy(true); setError(''); setSuccess('');
    try {
      let members = bandMembers;
      for (const id of bandAddIds) {
        const res = await api.addRefereeBand(Number(id), { competition: bandCompetition, sportSeason: selectedSeason, band: bandFilter });
        members = res.members || members;
      }
      setBandMembers(members);
      setSuccess(bandAddIds.length === 1 ? 'Arbitro aggiunto alla fascia.' : `${bandAddIds.length} arbitri aggiunti alla fascia.`);
      setBandAddIds([]);
      loadAllBands();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aggiunta non riuscita.');
    } finally { setBandBusy(false); }
  }

  async function removeBand(bandId) {
    setBandBusy(true); setError(''); setSuccess('');
    try {
      await api.removeRefereeBand(bandId);
      setBandMembers((prev) => prev.filter((m) => m.bandId !== bandId));
      setSuccess('Arbitro rimosso dalla fascia.');
      loadAllBands();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rimozione non riuscita.');
    } finally { setBandBusy(false); }
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    if (selectedSeason !== CURRENT_SEASON) cancelForm();
    loadReferees(selectedSeason);
    loadRanking(selectedSeason);
    loadAllBands();
  }, [canAccess, currentUser.instructorAssignments, currentUser.instructorCompetition, currentUser.instructorCompetitions, selectedSeason]);

  useEffect(() => {
    if (!canAccess || view !== 'bands') return;
    setBandAddIds([]);
    loadBands();
  }, [canAccess, view, bandCompetition, bandFilter, selectedSeason]);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function startCreate() {
    if (!hasRole(currentUser, 'admin')) return;
    setForm(EMPTY_FORM);
    setFormBands([]);
    setShowForm(true);
    setError('');
    setSuccess('');
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setFormBands([]);
    setShowForm(false);
  }

  async function refreshSeason() {
    await Promise.all([loadReferees(selectedSeason), loadRanking(selectedSeason), loadAllBands()]);
  }

  async function syncFormBands(refereeId, competition) {
    if (!competition) return;
    const existing = allBands.filter((item) =>
      item.refereeId === refereeId && item.competition === competition
    );
    await Promise.all([
      ...existing
        .filter((item) => !formBands.includes(item.band))
        .map((item) => api.removeRefereeBand(item.bandId)),
      ...formBands
        .filter((band) => !existing.some((item) => item.band === band))
        .map((band) => api.addRefereeBand(refereeId, {
          competition,
          sportSeason: selectedSeason,
          band
         }))
     ]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const payload = { ...form, sportSeason: selectedSeason };
      if (formBands.length && !form.category) {
        throw new ApiError('Seleziona una categoria prima di assegnare una fascia.');
      }
      const data = await api.createReferee(payload);
      await syncFormBands(data.referee.id, form.category);
      setSuccess('Arbitro creato.');
      setForm(EMPTY_FORM);
      setFormBands([]);
      setShowForm(false);
      await refreshSeason();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Operazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  function handleExport() {
    downloadRefereesExport({
      season: selectedSeason,
      competition: assignedCompetitions.length ? '' : filterCategory,
      status: filterStatus,
      band: filterBand,
      search
    });
  }

  function handleRankingExport() {
    downloadRefereeRankingExport({ season: selectedSeason });
  }

  if (!canAccess) {
    return <div className="empty-state"><h2>Area arbitri non associata</h2></div>;
  }

  const showColumn = (key) => visibleColumns.includes(key);

  const bandsByReferee = new Map();
  for (const m of allBands) {
    if (!bandsByReferee.has(m.refereeId)) bandsByReferee.set(m.refereeId, new Set());
    bandsByReferee.get(m.refereeId).add(m.band);
  }

  const filtered = referees.filter((r) => {
    const q = search.toLowerCase();
    const nameMatch = !q ||
      r.firstName.toLowerCase().includes(q) ||
      r.lastName.toLowerCase().includes(q) ||
      (r.province || '').toLowerCase().includes(q) ||
      (r.licenseNumber || '').toLowerCase().includes(q);
    const categoryMatch = assignedCompetitions.length ? assignedCompetitions.includes(r.category) : (!filterCategory || r.category === filterCategory);
    const statusMatch = !filterStatus || statusForSeason(r, selectedSeason) === filterStatus;
    const bandMatch = !filterBand || Boolean(bandsByReferee.get(r.id)?.has(filterBand));
    return nameMatch && categoryMatch && statusMatch && bandMatch;
  });
  const canManageCurrentSeason = hasRole(currentUser, 'admin') && selectedSeason === CURRENT_SEASON;
  // Le fasce sono storicizzate per stagione: admin e formatori possono quindi
  // completare o correggere anche quelle delle stagioni archiviate.
  const canManageBands = currentUser.role === 'admin' || currentUser.role === 'instructor';

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">{selectedSeason === CURRENT_SEASON ? 'Stagione corrente' : 'Archivio storico'}</p>
          <h1>{seasonTitle(selectedSeason)}</h1>
          <p>
            {assignedCompetitions.length
              ? `Arbitri e classifica ${assignedCompetitions.map(competitionLabel).join(', ')}.`
              : selectedSeason === CURRENT_SEASON
              ? 'Elenco arbitri della stagione in corso, con categoria, contatti e note.'
              : 'Consultazione storica degli arbitri assegnati a questa stagione.'}
          </p>
        </div>
        {!showForm && canManageCurrentSeason ? (
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={startCreate}>
              + Aggiungi arbitro
            </button>
          </div>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="toolbar-card">
        <div className="admin-referee-toolbar">
          <div className="view-switch">
            <button type="button" className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}>
              Elenco
            </button>
            <button type="button" className={view === 'ranking' ? 'is-active' : ''} onClick={() => setView('ranking')}>
              Classifica
            </button>
            <button type="button" className={view === 'bands' ? 'is-active' : ''} onClick={() => setView('bands')}>
              Fasce
            </button>
          </div>
        </div>
      </section>

      {showForm ? (
        <form className="common-card" onSubmit={handleSubmit}>
          <div className="section-heading">
            <div>
              <h2>Nuovo arbitro</h2>
              <p>
                {selectedSeason === CURRENT_SEASON
                  ? 'La categoria viene salvata per la stagione corrente.'
                  : `La categoria viene salvata nello storico ${selectedSeason}.`}
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={cancelForm}>Annulla</button>
          </div>

          <div className="common-grid">
            <label className="field field-span-2">
              Numero tessera
              <input
                value={form.licenseNumber}
                onChange={(e) => updateForm('licenseNumber', e.target.value)}
                placeholder="es. 68489"
              />
            </label>
            <label className="field field-span-2">
              <span className="required-label">
                Nome <small className="required-symbol">*</small>
              </span>
              <input value={form.firstName} onChange={(e) => updateForm('firstName', e.target.value)} required />
            </label>
            <label className="field field-span-2">
              <span className="required-label">
                Cognome <small className="required-symbol">*</small>
              </span>
              <input value={form.lastName} onChange={(e) => updateForm('lastName', e.target.value)} required />
            </label>
            <label className="field field-span-3">
              Data di nascita
              <DateInput value={form.birthDate} onChange={(v) => updateForm('birthDate', v)} />
            </label>
            <label className="field field-span-3">
              Scadenza certificato
              <DateInput value={form.certificateExpiry} onChange={(v) => updateForm('certificateExpiry', v)} />
            </label>
            <label className="field field-span-2">
              Email
              <input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} />
            </label>
            <label className="field field-span-2">
              Telefono
              <input type="tel" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} />
            </label>
            <label className="field field-span-2">
              Provincia
              <input
                value={form.province}
                onChange={(e) => updateForm('province', e.target.value)}
                placeholder="es. TORINO"
              />
            </label>
            <label className="field field-span-3">
              Categoria
              <Select
                value={form.category}
                onChange={(v) => updateForm('category', v)}
                placeholder="— Nessuna —"
                options={[
                  { value: '', label: '— Nessuna —' },
                  ...activeCompetitions.map((c) => ({ value: c.value, label: `${c.label} (${c.value})` }))
                ]}
              />
            </label>
            <label className="field field-span-3">
              Fasce
              <MultiSelect
                values={formBands}
                onChange={setFormBands}
                options={BAND_OPTIONS}
                placeholder={form.category ? 'Seleziona fasce…' : 'Prima scegli la categoria'}
                allLabel={form.category ? 'Nessuna fascia' : 'Prima scegli la categoria'}
              />
              <small style={{ color: 'var(--muted)', fontWeight: 500 }}>
                {form.category
                  ? `Valide per ${competitionLabel(form.category)} · ${selectedSeason}`
                  : 'Le fasce sono associate a campionato e stagione.'}
              </small>
            </label>
            <label className="field field-span-3" style={{ gridColumn: '1 / -1' }}>
              Note
              <textarea
                value={form.notes}
                onChange={(e) => updateForm('notes', e.target.value)}
                placeholder="Annotazioni personali sull'arbitro..."
                style={{ minHeight: '80px' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={cancelForm}>Annulla</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Salvataggio...' : 'Crea arbitro'}
            </button>
          </div>
        </form>
      ) : null}

      {view === 'list' ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Elenco arbitri{filtered.length !== referees.length ? ` (${filtered.length} di ${referees.length})` : ` (${referees.length})`}</h2>
            </div>
            <button type="button" className="ghost-button" onClick={handleExport} disabled={loading}>
              Esporta vista XLSX
            </button>
          </div>

          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Cerca per nome, cognome, tessera, provincia…' }}
            activeCount={(filterCategory ? 1 : 0) + (filterBand ? 1 : 0) + (filterStatus ? 1 : 0)}
            onReset={() => { setFilterCategory(''); setFilterBand(''); setFilterStatus(''); }}
            trailing={
              <ColumnsMenu columns={LIST_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
            }
          >
            {!assignedCompetitions.length ? (
              <Select
                value={filterCategory}
                onChange={setFilterCategory}
                placeholder="Categoria"
                placeholderOnEmpty
                options={[
                  { value: '', label: 'Tutte le categorie' },
                  ...activeCompetitions.map((c) => ({ value: c.value, label: c.label }))
                ]}
              />
            ) : null}
            <Select
              value={filterBand}
              onChange={setFilterBand}
              placeholder="Fascia"
              placeholderOnEmpty
              options={[{ value: '', label: 'Tutte le fasce' }, ...BAND_OPTIONS]}
            />
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder="Stato"
              placeholderOnEmpty
              options={[
                { value: '', label: 'Tutti gli stati' },
                ...REFEREE_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
              ]}
            />
          </FilterBar>

          {loading ? <ListSkeleton rows={6} /> : null}

          {!loading && filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
              {referees.length === 0
                ? currentUser.role === 'admin'
                  ? 'Nessun arbitro in questa stagione. Clicca "+ Aggiungi arbitro" per iniziare.'
                  : 'Nessun arbitro assegnato a questo campionato nella stagione selezionata.'
                : 'Nessun arbitro corrisponde ai filtri.'}
            </div>
          ) : null}

          {!loading && filtered.length > 0 ? (
            <div className="table-scroll">
              <table className="referee-table">
                <thead>
                  <tr>
                    {showColumn('license') ? <th>Tessera</th> : null}
                    <th>Cognome, Nome</th>
                    {showColumn('province') ? <th>Prov.</th> : null}
                    {showColumn('email') ? <th>Email</th> : null}
                    {showColumn('phone') ? <th>Telefono</th> : null}
                    {showColumn('certificate') ? <th>Scad. cert.</th> : null}
                    {showColumn('category') ? <th>Cat.</th> : null}
                    {showColumn('status') ? <th>Stato</th> : null}
                    {showColumn('notes') ? <th>Note</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const status = statusForSeason(r, selectedSeason);
                    // La "E" degli esordienti precede la tessera senza spostarla:
                    // occupa una corsia fissa a sinistra della cella.
                    const esordiente = Boolean(bandsByReferee.get(r.id)?.has('esordiente'));
                    const flag = esordiente ? (
                      <span className="referee-flag" title="Esordiente" aria-label="Esordiente">E</span>
                    ) : null;
                    return (
                      <tr
                        key={r.id}
                        className={isActiveStatus(status) ? 'is-clickable' : 'is-disabled is-clickable'}
                        onClick={() => navigate(`/admin/referees/${r.id}`)}
                      >
                        {showColumn('license') ? (
                          <td className="referee-license-cell">
                            {flag}
                            {r.licenseNumber || '-'}
                          </td>
                        ) : null}
                        <td
                          className={showColumn('license') ? '' : 'referee-flag-cell'}
                          style={{ fontWeight: 600 }}
                        >
                          {showColumn('license') ? null : flag}
                          {r.lastName} {r.firstName}
                        </td>
                        {showColumn('province') ? (
                          <td style={{ color: 'var(--muted)' }}>{r.province || '-'}</td>
                        ) : null}
                        {showColumn('email') ? (
                          <td style={{ color: 'var(--teal)', fontSize: '0.82rem' }}>{r.email || '-'}</td>
                        ) : null}
                        {showColumn('phone') ? (
                          <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.phone || '-'}</td>
                        ) : null}
                        {showColumn('certificate') ? (
                          <td
                            style={{
                              color: isExpiringSoon(r.certificateExpiry) ? 'var(--danger)' : 'var(--muted)',
                              whiteSpace: 'nowrap',
                              fontWeight: isExpiringSoon(r.certificateExpiry) ? 600 : 400
                            }}
                          >
                            {formatDate(r.certificateExpiry)}
                          </td>
                        ) : null}
                        {showColumn('category') ? (
                          <td>
                            {r.category ? (
                              <span className="status-badge status-badge-sm status-info">{r.category}</span>
                            ) : '-'}
                          </td>
                        ) : null}
                        {showColumn('status') ? (
                          <td>
                            <span className={`status-badge status-badge-sm status-${refereeStatusTone(status)}`}>
                              {refereeStatusLabel(status)}
                            </span>
                          </td>
                        ) : null}
                        {showColumn('notes') ? (
                          <td className="referee-notes-cell" title={r.notes || ''}>
                            {r.notes || '-'}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : view === 'ranking' ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Classifica arbitri</h2>
              <p>Ordinata per media voto nella stagione selezionata.</p>
            </div>
            <button type="button" className="ghost-button" onClick={handleRankingExport} disabled={loading}>
              Esporta classifica XLSX
            </button>
          </div>
          {ranking.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}>
              Nessun voto registrato in questa stagione.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="referee-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Arbitro</th>
                    <th>Cat.</th>
                    <th>Voti</th>
                    <th>A video</th>
                    <th>Media</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((row, idx) => (
                    <tr key={row.id} className="is-clickable" onClick={() => navigate(`/admin/referees/${row.id}`)}>
                      <td style={{ color: 'var(--muted)', fontWeight: 700 }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600 }}>{row.lastName} {row.firstName}</td>
                      <td>{row.category || '-'}</td>
                      <td>
                        <div className="vote-list">
                          {(row.voteDetails?.length
                            ? row.voteDetails
                            : row.votes.map((vote) => ({ vote, reportId: null, observerName: '' })))
                            .map((detail, i) => detail.reportId ? (
                              <button
                                key={`${row.id}-${detail.reportId}-${i}`}
                                type="button"
                                title={`Osservatore: ${detail.observerName || 'non indicato'} · apri il rapporto`}
                                aria-label={`Voto ${detail.vote}, osservatore ${detail.observerName || 'non indicato'}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/reports/${detail.reportId}`);
                                }}
                              >
                                {detail.vote}
                              </button>
                            ) : <span key={`${row.id}-${i}`}>{detail.vote}</span>)}
                        </div>
                      </td>
                      {/* Le visionature a video non hanno voto: senza questa colonna
                          un arbitro seguito via video sembrerebbe meno visionato. */}
                      <td style={{ color: 'var(--muted)' }}>{row.videoReportsCount || '-'}</td>
                      <td style={{ fontWeight: 800, color: 'var(--blue)' }}>{row.averageVote ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : view === 'bands' ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Fasce arbitri</h2>
              <p>Liste per campionato e stagione: esordienti, playoff, playout.</p>
            </div>
          </div>

          <div className="filter-bar">
            <div className="band-competition-filter">
              <Select
                value={bandCompetition}
                onChange={setBandCompetition}
                placeholder="Campionato"
                options={bandCompetitions.map((c) => ({ value: c, label: competitionLabel(c) }))}
              />
            </div>
            <div className="band-type-filter">
              <Select
                value={bandFilter}
                onChange={setBandFilter}
                placeholder="Fascia"
                options={BAND_OPTIONS}
              />
            </div>
            {canManageBands ? (
              <div className="band-add-menu">
                <MultiSelect
                  values={bandAddIds}
                  onChange={setBandAddIds}
                  triggerLabel="Aggiungi arbitri"
                  triggerClassName="band-add-trigger"
                  disabled={bandBusy}
                  actionLabel={`Aggiungi${bandAddIds.length ? ` (${bandAddIds.length})` : ''}`}
                  onAction={addBand}
                  actionDisabled={bandBusy || !bandAddIds.length}
                  options={bandPool
                    .filter((r) => !bandMembers.some((m) => m.refereeId === r.id))
                    .map((r) => ({ value: String(r.id), label: `${r.lastName} ${r.firstName}${r.licenseNumber ? ` · ${r.licenseNumber}` : ''}` }))}
                />
              </div>
            ) : null}
          </div>

          {bandMembers.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
              Nessun arbitro in questa fascia per il campionato selezionato.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="referee-table">
                <thead>
                  <tr>
                    <th>Tessera</th>
                    <th>Cognome, Nome</th>
                    <th>Stato</th>
                    {canManageBands ? <th>Azioni</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {bandMembers.map((m) => (
                    <tr key={m.bandId}>
                      <td style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: '0.82rem' }}>{m.licenseNumber || '-'}</td>
                      <td style={{ fontWeight: 600 }}>{m.fullName}</td>
                      <td>
                        <span className={`status-badge status-badge-sm status-${refereeStatusTone(m.status)}`}>
                          {refereeStatusLabel(m.status)}
                        </span>
                      </td>
                      {canManageBands ? (
                        <td>
                          <button type="button" className="danger-button" onClick={() => removeBand(m.bandId)} disabled={bandBusy}>
                            Rimuovi
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
