import { useEffect, useState } from 'react';
import { COMPETITIONS } from '../../../shared/reportTemplate.js';
import Select from '../components/Select.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';

function emptyForm(season) {
  return {
    name: '',
    sportSeason: season,
    competition: '',
    url: ''
  };
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return `${new Date(iso).toLocaleDateString('it-IT')} ${new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
}

const SYNC_STATUS_LABELS = {
  success: 'Completata',
  partial: 'Completata con avvisi',
  error: 'Errore',
  running: 'In corso'
};

export default function AdminSourcesPage({ currentUser, season }) {
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState(() => emptyForm(season));
  const [showForm, setShowForm] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [runsBySource, setRunsBySource] = useState({});
  const [expandedRuns, setExpandedRuns] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [renaming, setRenaming] = useState(null); // id della sorgente in rinomina
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isAdmin = currentUser.role === 'admin';

  async function load() {
    setLoading(true);
    try {
      const data = await api.listSources({ season });
      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare le sorgenti.');
    } finally {
      setLoading(false);
    }
  }

  function startRename(source) {
    setRenaming(source.id);
    setRenameValue(source.name);
    setError('');
    setSuccess('');
  }

  async function handleRename(source) {
    const name = renameValue.trim();
    if (!name || name === source.name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.updateSource(source.id, { name });
      setSuccess(`Sorgente rinominata in "${name}".`);
      setRenaming(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rinomina non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    setForm(emptyForm(season));
    setShowForm(false);
    setSyncResult(null);
    setExpandedRuns(null);
    load();
  }, [isAdmin, season]);

  if (!isAdmin) {
    return <div className="empty-state"><h2>Sezione riservata agli amministratori</h2></div>;
  }

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.createSource(form);
      const created = data.sources || [];
      const names = created.map((s) => s.name).join(', ');
      const base = created.length > 1
        ? `Creati ${created.length} gironi (${names}). Ora sincronizzali uno alla volta.`
        : `Sorgente "${names}" creata. Ora puoi eseguire la prima sincronizzazione.`;
      const skippedMsg = data.skipped?.length ? ` Già configurati e saltati: ${data.skipped.join(', ')}.` : '';
      setSuccess(base + skippedMsg);
      setForm(emptyForm(season));
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Creazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSync(source) {
    if (syncingId) return;
    setSyncingId(source.id);
    setError('');
    setSuccess('');
    setSyncResult(null);
    try {
      const data = await api.syncSource(source.id);
      setSyncResult({ sourceName: source.name, ...data.result });
      await load();
      if (expandedRuns === source.id) await loadRuns(source.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sincronizzazione non riuscita.');
    } finally {
      setSyncingId(null);
    }
  }

  async function toggleActive(source) {
    setError('');
    try {
      await api.updateSource(source.id, { active: !source.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Operazione non riuscita.');
    }
  }

  async function loadRuns(sourceId) {
    try {
      const data = await api.listSourceRuns(sourceId);
      setRunsBySource((prev) => ({ ...prev, [sourceId]: data.runs || [] }));
    } catch {
      setRunsBySource((prev) => ({ ...prev, [sourceId]: [] }));
    }
  }

  async function toggleRuns(sourceId) {
    if (expandedRuns === sourceId) {
      setExpandedRuns(null);
      return;
    }
    setExpandedRuns(sourceId);
    await loadRuns(sourceId);
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteSource(deleting.id);
      setSuccess(`Sorgente "${deleting.name}" eliminata. Le gare già importate restano nel database.`);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eliminazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione · stagione {season}</p>
          <h1>Sorgenti gare e sincronizzazioni</h1>
          <p>
            Incolla il link pubblico FIP del girone (pagina "Risultati") per importare calendario e
            designazioni. La sincronizzazione non tocca mai gli osservatori né i dati bloccati.
          </p>
        </div>
        {!showForm ? (
          <button type="button" className="hero-button" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }}>
            + Nuova sorgente
          </button>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      {syncResult ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Esito sincronizzazione — {syncResult.sourceName}</h2>
              <p>
                {syncResult.giornate} giornate lette · {syncResult.created} gare create ·{' '}
                {syncResult.updated} aggiornate · {syncResult.officialsUpdated} designazioni aggiornate
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setSyncResult(null)}>Chiudi</button>
          </div>

          {syncResult.unresolved?.length ? (
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ marginBottom: '6px' }}>Nominativi da associare ({syncResult.unresolved.length})</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
                Apri la gara per confermare l'associazione all'anagrafica: verrà ricordata per le prossime sincronizzazioni.
              </p>
              <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                {syncResult.unresolved.map((item, idx) => (
                  <li key={idx}>
                    <strong>{item.externalName}</strong> — gara {item.matchNumber} ({item.role})
                    {item.candidates?.length ? (
                      <span style={{ color: 'var(--muted)' }}>
                        {' '}· candidati: {item.candidates.map((c) => c.fullName).join(', ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {syncResult.conflicts?.length ? (
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ marginBottom: '6px' }}>Conflitti da verificare ({syncResult.conflicts.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="referee-table">
                  <thead>
                    <tr>
                      <th>Gara</th>
                      <th>Campo</th>
                      <th>Valore attuale</th>
                      <th>Valore FIP</th>
                      <th>Origini</th>
                      <th>Azione proposta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.conflicts.map((c, idx) => (
                      <tr key={idx}>
                        <td style={{ fontFamily: 'monospace' }}>{c.matchNumber}</td>
                        <td>{c.field}</td>
                        <td>{c.currentValue || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{c.incomingValue || '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>{c.currentSource} → {c.incomingSource}</td>
                        <td style={{ color: 'var(--muted)' }}>{c.proposal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {syncResult.errors?.length ? (
            <div>
              <h3 style={{ marginBottom: '6px', color: 'var(--danger)' }}>Errori ({syncResult.errors.length})</h3>
              <ul style={{ paddingLeft: '18px' }}>
                {syncResult.errors.map((e, idx) => (
                  <li key={idx}>{e.matchNumber ? `Gara ${e.matchNumber}: ` : ''}{e.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!syncResult.unresolved?.length && !syncResult.conflicts?.length && !syncResult.errors?.length ? (
            <p>Nessun conflitto e nessun nominativo da associare.</p>
          ) : null}

          <div style={{ marginTop: '10px' }}>
            <button type="button" className="primary-button" onClick={() => navigate('/games')}>
              Vai alle gare
            </button>
          </div>
        </section>
      ) : null}

      {showForm ? (
        <form className="common-card" onSubmit={handleCreate}>
          <div className="section-heading">
            <div>
              <h2>Nuova sorgente FIP</h2>
              <p>
                Apri fip.it → Risultati → seleziona campionato e fase, poi copia qui l'indirizzo
                della pagina: i gironi vengono trovati da soli e viene creata una sorgente per
                ognuno. Sono accettati solo link https del sito fip.it.
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annulla</button>
          </div>
          <div className="common-grid">
            <div className="field field-span-3">
              <span>Stagione della nuova sorgente</span>
              <strong>{season}</strong>
            </div>
            <label className="field field-span-3">
              <span className="required-label">Link FIP del girone <small className="required-symbol">*</small></span>
              <input
                value={form.url}
                onChange={(e) => updateForm('url', e.target.value)}
                placeholder="https://fip.it/risultati/?...&codice_girone=..."
                required
              />
            </label>
            <label className="field field-span-3">
              Nome visualizzato (con più gironi diventa un prefisso, es. "DR1 — Girone A")
              <input value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="es. DR1 Piemonte" />
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
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Annulla</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Creazione...' : 'Crea sorgente'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Sorgenti configurate ({sources.length})</h2>
            <p>Una stagione può avere più sorgenti: regular season, fasi finali, coppe.</p>
          </div>
        </div>

        {loading ? <div className="empty-state" style={{ padding: '24px' }}>Caricamento...</div> : null}

        {!loading && sources.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
            Nessuna sorgente configurata. Clicca "+ Nuova sorgente" e incolla il link FIP del girone.
          </div>
        ) : null}

        {!loading && sources.length > 0 ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {sources.map((source) => (
              <div key={source.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: '1 1 260px' }}>
                    {renaming === source.id ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(source);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          autoFocus
                          style={{ flex: '1 1 180px' }}
                        />
                        <button type="button" className="primary-button" onClick={() => handleRename(source)} disabled={busy}>Salva</button>
                        <button type="button" className="ghost-button" onClick={() => setRenaming(null)}>Annulla</button>
                      </div>
                    ) : (
                      <strong>{source.name}</strong>
                    )}
                    <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                      {source.sportSeason}
                      {source.competition ? ` · ${source.competition}` : ''}
                      {' · '}
                      Ultima sincronizzazione: {formatDateTime(source.lastSyncedAt)}
                      {source.lastSyncStatus ? ` (${SYNC_STATUS_LABELS[source.lastSyncStatus] || source.lastSyncStatus})` : ''}
                    </div>
                  </div>
                  <span className={`status-badge ${source.active ? 'status-final' : 'status-draft'}`} style={{ padding: '3px 8px', fontSize: '0.72rem' }}>
                    {source.active ? 'Attiva' : 'Disattivata'}
                  </span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => handleSync(source)}
                      disabled={Boolean(syncingId) || !source.active}
                    >
                      {syncingId === source.id ? 'Sincronizzo…' : 'Sincronizza'}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => startRename(source)}>
                      Rinomina
                    </button>
                    <button type="button" className="ghost-button" onClick={() => toggleRuns(source.id)}>
                      {expandedRuns === source.id ? 'Nascondi storico' : 'Storico'}
                    </button>
                    <button type="button" className="ghost-button" onClick={() => toggleActive(source)}>
                      {source.active ? 'Disattiva' : 'Riattiva'}
                    </button>
                    <button type="button" className="danger-button" onClick={() => setDeleting(source)}>
                      Elimina
                    </button>
                  </div>
                </div>

                {expandedRuns === source.id ? (
                  <div style={{ marginTop: '10px', overflowX: 'auto' }}>
                    {(runsBySource[source.id] || []).length ? (
                      <table className="referee-table">
                        <thead>
                          <tr>
                            <th>Avviata</th>
                            <th>Da</th>
                            <th>Esito</th>
                            <th>Create</th>
                            <th>Aggiornate</th>
                            <th>Conflitti</th>
                            <th>Errori</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(runsBySource[source.id] || []).map((run) => (
                            <tr key={run.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(run.startedAt)}</td>
                              <td>{run.startedByName || '—'}</td>
                              <td>{SYNC_STATUS_LABELS[run.status] || run.status}</td>
                              <td>{run.createdCount}</td>
                              <td>{run.updatedCount}</td>
                              <td style={{ color: run.conflictCount ? 'var(--orange)' : 'inherit' }}>{run.conflictCount}</td>
                              <td style={{ color: run.errorCount ? 'var(--danger)' : 'inherit' }}>{run.errorCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="empty-state" style={{ padding: '12px' }}>Nessuna sincronizzazione eseguita.</div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {deleting ? (
        <ConfirmModal
          title={`Eliminare la sorgente "${deleting.name}"?`}
          confirmLabel="Elimina sorgente"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        >
          Le gare già importate restano nel database e non vengono toccate. Verrà rimossa solo la
          configurazione della sorgente e la possibilità di sincronizzare.
        </ConfirmModal>
      ) : null}
    </div>
  );
}
