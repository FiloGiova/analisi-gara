import { useEffect, useState } from 'react';
import { COMPETITIONS, currentSportSeason } from '../../../shared/reportTemplate.js';
import DateInput from '../components/DateInput.jsx';
import Select from '../components/Select.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';

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

function formatDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('it-IT'); } catch { return iso; }
}

function isExpiringSoon(iso) {
  if (!iso) return false;
  return (new Date(iso) - new Date()) < 90 * 86400 * 1000;
}

function seasonTitle(season) {
  return season === CURRENT_SEASON ? 'Anagrafica arbitri' : `Archivio arbitri ${season}`;
}

function competitionLabel(value) {
  return COMPETITIONS.find((competition) => competition.value === value)?.label || value;
}

function activeForSeason(referee, season) {
  return season === CURRENT_SEASON ? referee.active : referee.seasonActive;
}

function instructorCompetitionsForUser(user) {
  if (user?.role !== 'instructor') return [];
  if (Array.isArray(user?.instructorCompetitions)) return user.instructorCompetitions;
  if (user?.instructorCompetition) return [user.instructorCompetition];
  if (Array.isArray(user?.formatterCompetitions)) return user.formatterCompetitions;
  return user?.formatterCompetition ? [user.formatterCompetition] : [];
}

export default function AdminRefereesPage({ currentUser, season: selectedSeason }) {
  const assignedCompetitions = instructorCompetitionsForUser(currentUser);
  const canAccess = currentUser.role === 'admin' || assignedCompetitions.length > 0;
  const [referees, setReferees] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [filterBand, setFilterBand] = useState(''); // filtro fascia nell'elenco
  const [allBands, setAllBands] = useState([]); // tutte le appartenenze fascia della stagione
  // Vista Fasce
  const bandCompetitions = assignedCompetitions.length ? assignedCompetitions : COMPETITIONS.map((c) => c.value);
  const [bandCompetition, setBandCompetition] = useState(bandCompetitions[0] || '');
  const [bandFilter, setBandFilter] = useState('esordiente');
  const [bandMembers, setBandMembers] = useState([]);
  const [bandPool, setBandPool] = useState([]);
  const [bandAddIds, setBandAddIds] = useState([]); // selezione multipla per inserimento in blocco
  const [bandBusy, setBandBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formBands, setFormBands] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
  }, [canAccess, currentUser.instructorCompetition, currentUser.instructorCompetitions, selectedSeason]);

  useEffect(() => {
    if (!canAccess || view !== 'bands') return;
    setBandAddIds([]);
    loadBands();
  }, [canAccess, view, bandCompetition, bandFilter, selectedSeason]);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function startCreate() {
    if (currentUser.role !== 'admin') return;
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormBands([]);
    setShowForm(true);
    setError('');
    setSuccess('');
  }

  function startEdit(referee) {
    if (currentUser.role !== 'admin') return;
    setEditingId(referee.id);
    setForm({
      licenseNumber: referee.licenseNumber || '',
      firstName: referee.firstName,
      lastName: referee.lastName,
      birthDate: referee.birthDate || '',
      email: referee.email || '',
      phone: referee.phone || '',
      province: referee.province || '',
      certificateExpiry: referee.certificateExpiry || '',
      category: referee.category || '',
      notes: referee.notes || ''
    });
    setFormBands(allBands
      .filter((item) => item.refereeId === referee.id && item.competition === referee.category)
      .map((item) => item.band));
    setShowForm(true);
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelForm() {
    setEditingId(null);
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
      if (editingId) {
        await api.updateReferee(editingId, payload);
        await syncFormBands(editingId, form.category);
        setSuccess('Arbitro aggiornato.');
      } else {
        const data = await api.createReferee(payload);
        await syncFormBands(data.referee.id, form.category);
        setSuccess('Arbitro creato.');
      }
      setEditingId(null);
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

  async function handleToggleActive(referee) {
    if (currentUser.role !== 'admin') return;
    setError('');
    setSuccess('');
    try {
      await api.updateReferee(referee.id, {
        sportSeason: selectedSeason,
        active: !referee.active
      });
      setSuccess(referee.active ? 'Arbitro disattivato.' : 'Arbitro riattivato.');
      await refreshSeason();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Operazione non riuscita.');
    }
  }

  if (!canAccess) {
    return <div className="empty-state"><h2>Area arbitri non associata</h2></div>;
  }

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
    const activeMatch = filterActive === '' || String(activeForSeason(r, selectedSeason) ? '1' : '0') === filterActive;
    const bandMatch = !filterBand || Boolean(bandsByReferee.get(r.id)?.has(filterBand));
    return nameMatch && categoryMatch && activeMatch && bandMatch;
  });
  const canManageCurrentSeason = currentUser.role === 'admin' && selectedSeason === CURRENT_SEASON;
  // Le fasce le gestiscono admin e formatori (sui propri campionati), stagione corrente.
  const canManageBands = (currentUser.role === 'admin' || currentUser.role === 'instructor') && selectedSeason === CURRENT_SEASON;

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
          <button type="button" className="hero-button" onClick={startCreate}>
            + Aggiungi arbitro
          </button>
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
              <h2>{editingId ? 'Modifica arbitro' : 'Nuovo arbitro'}</h2>
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
                  ...COMPETITIONS.map((c) => ({ value: c.value, label: `${c.label} (${c.value})` }))
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
              {busy ? 'Salvataggio...' : editingId ? 'Aggiorna arbitro' : 'Crea arbitro'}
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
          </div>

          <div className="games-filters-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, cognome, tessera, provincia..."
              style={{ flex: '1 1 240px', minHeight: '46px', boxSizing: 'border-box' }}
            />
            <div style={{ flex: '0 1 170px' }}>
              <Select
                value={filterBand}
                onChange={setFilterBand}
                placeholder="Tutte le fasce"
                options={[{ value: '', label: 'Tutte le fasce' }, ...BAND_OPTIONS]}
              />
            </div>
            {!assignedCompetitions.length ? (
              <div style={{ flex: '0 1 240px' }}>
                <Select
                  value={filterCategory}
                  onChange={setFilterCategory}
                  placeholder="Tutte le categorie"
                  options={[
                    { value: '', label: 'Tutte le categorie' },
                    ...COMPETITIONS.map((c) => ({ value: c.value, label: c.label }))
                  ]}
                />
              </div>
            ) : null}
            <div style={{ flex: '0 1 150px' }}>
              <Select
                value={filterActive}
                onChange={setFilterActive}
                placeholder="Tutti"
                options={[
                  { value: '', label: 'Tutti' },
                  { value: '1', label: 'Attivi' },
                  { value: '0', label: 'Inattivi' }
                ]}
              />
            </div>
          </div>

          {loading ? <div className="empty-state" style={{ padding: '24px' }}>Caricamento...</div> : null}

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
            <div style={{ overflowX: 'auto' }}>
              <table className="referee-table">
                <thead>
                  <tr>
                    <th>Tessera</th>
                    <th>Cognome, Nome</th>
                    <th>Prov.</th>
                    <th>Email</th>
                    <th>Telefono</th>
                    <th>Scad. cert.</th>
                    <th>Cat.</th>
                    <th>Stato</th>
                    <th>Note</th>
                    {canManageCurrentSeason ? <th>Azioni</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={activeForSeason(r, selectedSeason) ? 'is-clickable' : 'is-disabled is-clickable'}
                      onClick={() => navigate(`/admin/referees/${r.id}`)}
                    >
                      <td style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: '0.82rem' }}>
                        {r.licenseNumber || '-'}
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.lastName} {r.firstName}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.province || '-'}</td>
                      <td style={{ color: 'var(--teal)', fontSize: '0.82rem' }}>{r.email || '-'}</td>
                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.phone || '-'}</td>
                      <td
                        style={{
                          color: isExpiringSoon(r.certificateExpiry) ? 'var(--danger)' : 'var(--muted)',
                          whiteSpace: 'nowrap',
                          fontWeight: isExpiringSoon(r.certificateExpiry) ? 600 : 400
                        }}
                      >
                        {formatDate(r.certificateExpiry)}
                      </td>
                      <td>
                        {r.category ? (
                          <span
                            className="status-badge"
                            style={{ background: 'var(--blue-soft)', color: 'var(--blue)', padding: '3px 8px', fontSize: '0.72rem' }}
                          >
                            {r.category}
                          </span>
                        ) : '-'}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${activeForSeason(r, selectedSeason) ? 'status-final' : 'status-draft'}`}
                          style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                        >
                          {activeForSeason(r, selectedSeason) ? 'Attivo' : 'Inattivo'}
                        </span>
                      </td>
                      <td className="referee-notes-cell" title={r.notes || ''}>
                        {r.notes || '-'}
                      </td>
                      {canManageCurrentSeason ? (
                        <td>
                          <div className="referee-row-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => startEdit(r)}
                            >
                              Modifica
                            </button>
                            <button
                              type="button"
                              className={r.active ? 'danger-button' : 'ghost-button'}
                              onClick={() => handleToggleActive(r)}
                            >
                              {r.active ? 'Disattiva' : 'Riattiva'}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
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
          </div>
          {ranking.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}>
              Nessun voto registrato in questa stagione.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="referee-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Arbitro</th>
                    <th>Cat.</th>
                    <th>Voti</th>
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
                          {row.votes.map((vote, i) => <span key={`${row.id}-${i}`}>{vote}</span>)}
                        </div>
                      </td>
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

          <div className="band-filters-row">
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
            <div style={{ overflowX: 'auto' }}>
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
                        <span className={`status-badge ${m.active ? 'status-final' : 'status-draft'}`} style={{ padding: '3px 8px', fontSize: '0.72rem' }}>
                          {m.active ? 'Attivo' : 'Inattivo'}
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
