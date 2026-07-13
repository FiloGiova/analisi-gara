import { useEffect, useRef, useState } from 'react';
import { api, ApiError, downloadDesignationsTemplate } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatMatchNumber } from '../lib/formatters.js';

const ROLE_LABELS = {
  referee1: '1° arbitro',
  referee2: '2° arbitro',
  referee3: '3° arbitro',
  observer: 'Osservatore'
};

const ACTION_STYLES = {
  nuovo: { label: 'Nuovo', background: 'var(--final-soft)', color: 'var(--final)' },
  aggiornato: { label: 'Aggiornato', background: 'var(--blue-soft)', color: 'var(--blue)' },
  invariato: { label: 'Invariato', background: 'var(--paper-2)', color: 'var(--muted)' },
  conflitto: { label: 'Conflitto', background: 'var(--orange-soft)', color: 'var(--danger)' }
};

function ActionBadge({ action }) {
  const style = ACTION_STYLES[action] || ACTION_STYLES.invariato;
  return (
    <span className="status-badge" style={{ background: style.background, color: style.color, padding: '2px 7px', fontSize: '0.7rem' }}>
      {style.label}
    </span>
  );
}

export default function AdminImportsPage({ currentUser, season }) {
  const [preview, setPreview] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileRef = useRef(null);

  const isAdmin = currentUser.role === 'admin';

  useEffect(() => {
    setPreview(null);
    setApplyResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }, [season]);

  if (!isAdmin) {
    return <div className="empty-state"><h2>Sezione riservata agli amministratori</h2></div>;
  }

  async function handlePreview(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Seleziona il file XLSX compilato dal designatore.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    setApplyResult(null);
    try {
      const data = await api.previewDesignationsImport(file, season);
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : 'Anteprima non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview?.rows?.length) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.applyDesignationsImport({ sportSeason: preview.sportSeason, rows: preview.rows });
      setApplyResult(data.result);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      setSuccess('Importazione applicata.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Importazione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  const summary = preview?.summary;

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione</p>
          <h1>Import designazioni (XLSX)</h1>
          <p>
            Scarica il template con le gare della stagione, passalo al designatore e ricarica qui il
            file compilato. L'anteprima non modifica nulla: si applica solo dopo conferma.
          </p>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>1 · Template per il designatore</h2>
            <p>
              Un foglio per ogni giornata, già compilato con numero gara, data, squadre e le
              designazioni note. Dopo una modifica in corso d'opera basta riscaricarlo: viene
              rigenerato ogni volta con i dati aggiornati.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="status-badge status-draft">Stagione {season}</span>
          <button type="button" className="primary-button" onClick={() => downloadDesignationsTemplate(season)}>
            Scarica template ({season})
          </button>
        </div>
      </section>

      <form className="common-card" onSubmit={handlePreview}>
        <div className="section-heading">
          <div>
            <h2>2 · Carica il file compilato</h2>
            <p>
              Il numero gara è la chiave: vengono aggiornate solo gare già presenti. Le celle vuote
              sono ignorate e non cancellano designazioni esistenti.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ maxWidth: '320px' }} />
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Analizzo…' : 'Anteprima (nessuna modifica)'}
          </button>
        </div>
      </form>

      {preview ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>3 · Anteprima — {preview.sportSeason}</h2>
              <p>
                {summary.totalRows} righe · {summary.toCreate} nuove designazioni · {summary.toUpdate} aggiornate ·{' '}
                {summary.unchanged} invariate · {summary.conflicts} conflitti · {summary.unresolved} nomi da associare ·{' '}
                {summary.notFound} gare non trovate
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setPreview(null)}>Annulla</button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="referee-table">
              <thead>
                <tr>
                  <th>Gara</th>
                  <th>Foglio</th>
                  <th>Designazioni nel file</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, idx) => (
                  <tr key={idx} style={row.status === 'errore' ? { background: 'var(--orange-soft)' } : undefined}>
                    <td style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{formatMatchNumber(row.matchNumber)}</td>
                    <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{row.sheetName} · r.{row.rowNumber}</td>
                    <td>
                      {row.status === 'errore' ? (
                        <span style={{ color: 'var(--danger)' }}>{row.message}</span>
                      ) : row.items.length === 0 ? (
                        <span style={{ color: 'var(--muted)' }}>Nessuna designazione nella riga.</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {row.items.map((item, i) => (
                            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ color: 'var(--muted)', minWidth: '86px', fontSize: '0.8rem' }}>{ROLE_LABELS[item.role]}</span>
                              <strong>{item.name}</strong>
                              <ActionBadge action={item.action} />
                              {!item.resolvedId && item.action !== 'invariato' ? (
                                <span className="status-badge" style={{ background: 'var(--paper-2)', color: 'var(--danger)', padding: '2px 7px', fontSize: '0.7rem' }}>
                                  Da associare{item.candidates?.length ? ` (candidati: ${item.candidates.map((c) => c.fullName || c.displayName).join(', ')})` : ''}
                                </span>
                              ) : null}
                              {item.action === 'conflitto' ? (
                                <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                                  attuale: {item.currentName || '—'} ({item.locked ? 'bloccato' : 'manuale'})
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button type="button" className="ghost-button" onClick={() => setPreview(null)}>Annulla</button>
            <button type="button" className="primary-button" onClick={handleApply} disabled={busy || summary.totalRows === summary.notFound}>
              {busy ? 'Applico…' : `Conferma importazione (${summary.toCreate + summary.toUpdate} modifiche)`}
            </button>
          </div>
        </section>
      ) : null}

      {applyResult ? (
        <section className="common-card">
          <div className="section-heading">
            <div>
              <h2>Esito importazione</h2>
              <p>
                {applyResult.applied} designazioni applicate · {applyResult.unchanged} invariate ·{' '}
                {applyResult.conflicts.length} conflitti · {applyResult.unresolved.length} nomi da associare ·{' '}
                {applyResult.errors.length} errori
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setApplyResult(null)}>Chiudi</button>
          </div>

          {applyResult.conflicts.length ? (
            <div style={{ marginBottom: '10px' }}>
              <h3 style={{ marginBottom: '6px' }}>Conflitti (non applicati)</h3>
              <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                {applyResult.conflicts.map((c, i) => (
                  <li key={i}>
                    Gara <strong>{formatMatchNumber(c.matchNumber)}</strong> · {c.field}: attuale "{c.currentValue}" ({c.currentSource}) vs file "{c.incomingValue}" — {c.proposal}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {applyResult.unresolved.length ? (
            <div style={{ marginBottom: '10px' }}>
              <h3 style={{ marginBottom: '6px' }}>Nomi da associare</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                Le designazioni sono state salvate col nome del file: apri la gara per confermare
                l'associazione (verrà ricordata per i prossimi import).
              </p>
              <ul style={{ paddingLeft: '18px', display: 'grid', gap: '4px' }}>
                {applyResult.unresolved.map((u, i) => (
                  <li key={i}><strong>{u.externalName}</strong> — gara {formatMatchNumber(u.matchNumber)} ({ROLE_LABELS[u.role]})</li>
                ))}
              </ul>
            </div>
          ) : null}

          {applyResult.errors.length ? (
            <div style={{ marginBottom: '10px' }}>
              <h3 style={{ marginBottom: '6px', color: 'var(--danger)' }}>Errori</h3>
              <ul style={{ paddingLeft: '18px' }}>
                {applyResult.errors.map((e, i) => (
                  <li key={i}>Gara {formatMatchNumber(e.matchNumber)}: {e.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <button type="button" className="primary-button" onClick={() => navigate('/games')}>
            Vai alle gare
          </button>
        </section>
      ) : null}
    </div>
  );
}
