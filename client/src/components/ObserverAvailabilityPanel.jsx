import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatDateTime } from '../lib/formatters.js';
import { formatAvailabilityPeriod } from '../lib/observerAvailability.js';
import DateInput from './DateInput.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import ListSkeleton from './ListSkeleton.jsx';

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function periodDays(item) {
  const start = Date.parse(`${item.startDate}T00:00:00Z`);
  const end = Date.parse(`${item.endDate}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) + 1 : 1;
}

function availabilityState(item, today) {
  if (item.endDate < today) return { key: 'past', label: 'Trascorsa', className: 'status-neutral' };
  if (item.startDate <= today) return { key: 'current', label: 'In corso', className: 'status-alert' };
  return { key: 'upcoming', label: 'Programmata', className: 'status-warning' };
}

export default function ObserverAvailabilityPanel({ observerId, onProfileLoaded, showDirectoryLink = false }) {
  const [profile, setProfile] = useState(null);
  const [mode, setMode] = useState('single');
  const [form, setForm] = useState({ startDate: '', endDate: '', note: '' });
  const [removeItem, setRemoveItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const today = localToday();

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getObserver(observerId);
      setProfile(data);
      onProfileLoaded?.(data.observer);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare le indisponibilità.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [observerId]);

  const ordered = useMemo(() => {
    const items = [...(profile?.unavailabilities || [])];
    const rank = { current: 0, upcoming: 1, past: 2 };
    return items.sort((a, b) => {
      const stateA = availabilityState(a, today).key;
      const stateB = availabilityState(b, today).key;
      if (rank[stateA] !== rank[stateB]) return rank[stateA] - rank[stateB];
      return stateA === 'past'
        ? b.startDate.localeCompare(a.startDate)
        : a.startDate.localeCompare(b.startDate);
    });
  }, [profile?.unavailabilities, today]);

  const currentCount = ordered.filter((item) => availabilityState(item, today).key === 'current').length;
  const upcomingCount = ordered.filter((item) => availabilityState(item, today).key === 'upcoming').length;

  function changeMode(nextMode) {
    setMode(nextMode);
    if (nextMode === 'single') {
      setForm((previous) => ({ ...previous, endDate: previous.startDate }));
    }
  }

  function handleModeKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === 'ArrowLeft' ? 'single' : 'period';
    changeMode(nextMode);
    requestAnimationFrame(() => {
      event.currentTarget.parentElement?.querySelector(`[data-mode="${nextMode}"]`)?.focus();
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const endDate = mode === 'single' ? form.startDate : form.endDate;
    if (!form.startDate || !endDate) {
      setError(mode === 'single' ? 'Inserisci il giorno di indisponibilità.' : 'Inserisci data iniziale e data finale.');
      return;
    }
    if (endDate < form.startDate) {
      setError('La data finale non può precedere quella iniziale.');
      return;
    }

    setBusy(true);
    try {
      await api.createObserverUnavailability(observerId, {
        startDate: form.startDate,
        endDate,
        note: form.note
      });
      setForm({ startDate: '', endDate: '', note: '' });
      setSuccess(mode === 'single' ? 'Giorno di indisponibilità aggiunto.' : 'Periodo di indisponibilità aggiunto.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeItem) return;
    const item = removeItem;
    setRemoveItem(null);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.deleteObserverUnavailability(observerId, item.id);
      setSuccess('Indisponibilità rimossa.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rimozione non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {removeItem ? (
        <ConfirmModal
          title="Rimuovi indisponibilità"
          confirmLabel="Rimuovi indisponibilità"
          confirmClassName="danger-button"
          onConfirm={confirmRemove}
          onCancel={() => setRemoveItem(null)}
        >
          Rimuovere l'indisponibilità del periodo <strong>{formatAvailabilityPeriod(removeItem)}</strong>?
        </ConfirmModal>
      ) : null}

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {success ? <div className="success-banner" role="status">{success}</div> : null}

      <section className="common-card availability-editor-card">
        <div className="section-heading">
          <div>
            <h2>Aggiungi indisponibilità</h2>
            <p>Inserisci un solo giorno oppure un periodo continuo. Le date valgono indipendentemente dalla stagione.</p>
          </div>
          {showDirectoryLink ? (
            <button type="button" className="ghost-button" onClick={() => navigate('/observers')}>
              Gestisci osservatori
            </button>
          ) : null}
        </div>

        <form className="availability-form" onSubmit={handleSubmit}>
          <div className="availability-mode" role="radiogroup" aria-label="Tipo di indisponibilità">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'single'}
              data-mode="single"
              tabIndex={mode === 'single' ? 0 : -1}
              className={mode === 'single' ? 'is-selected' : ''}
              onClick={() => changeMode('single')}
              onKeyDown={handleModeKeyDown}
            >
              Giorno singolo
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'period'}
              data-mode="period"
              tabIndex={mode === 'period' ? 0 : -1}
              className={mode === 'period' ? 'is-selected' : ''}
              onClick={() => changeMode('period')}
              onKeyDown={handleModeKeyDown}
            >
              Periodo
            </button>
          </div>

          <div className={`availability-fields ${mode === 'single' ? 'is-single' : ''}`}>
            <label className="field">
              {mode === 'single' ? 'Giorno' : 'Dal'}
              <DateInput
                value={form.startDate}
                onChange={(startDate) => setForm((previous) => ({
                  ...previous,
                  startDate,
                  ...(mode === 'single' ? { endDate: startDate } : {})
                }))}
                required
              />
            </label>
            {mode === 'period' ? (
              <label className="field">
                Al
                <DateInput
                  value={form.endDate}
                  onChange={(endDate) => setForm((previous) => ({ ...previous, endDate }))}
                  required
                />
              </label>
            ) : null}
            <label className="field availability-note-field">
              Nota <small>(facoltativa)</small>
              <input
                value={form.note}
                onChange={(event) => setForm((previous) => ({ ...previous, note: event.target.value }))}
                maxLength={300}
                placeholder="es. ferie, impegno personale"
              />
            </label>
            <button type="submit" className="primary-button availability-submit" disabled={busy || loading}>
              {busy ? 'Salvataggio…' : 'Aggiungi indisponibilità'}
            </button>
          </div>
        </form>
      </section>

      <section className="common-card">
        <div className="section-heading availability-history-heading">
          <div>
            <h2>Storico indisponibilità</h2>
            <p>Periodi in corso, programmati e trascorsi. Lo storico non cambia quando cambia la stagione selezionata.</p>
          </div>
          <div className="availability-overview" aria-label="Riepilogo indisponibilità">
            {currentCount ? <span className="status-badge status-alert">{currentCount} in corso</span> : null}
            <span className="status-badge status-warning">{upcomingCount} programmate</span>
            <span className="status-badge status-neutral">{ordered.length} totali</span>
          </div>
        </div>

        {loading ? <ListSkeleton rows={3} /> : null}
        {!loading && ordered.length === 0 ? (
          <div className="empty-state availability-empty">
            <h3>Nessuna indisponibilità registrata</h3>
            <p>Quando aggiungi un giorno o un periodo, comparirà qui e verrà applicato automaticamente alle designazioni.</p>
          </div>
        ) : null}
        {!loading && ordered.length ? (
          <div className="availability-history-list">
            {ordered.map((item) => {
              const state = availabilityState(item, today);
              const days = periodDays(item);
              return (
                <article className={`availability-history-row is-${state.key}`} key={item.id}>
                  <div className="availability-date-mark" aria-hidden="true">
                    <span>{item.startDate.slice(8, 10)}</span>
                    <small>{new Date(`${item.startDate}T12:00:00`).toLocaleDateString('it-IT', { month: 'short' })}</small>
                  </div>
                  <div className="availability-history-copy">
                    <div className="availability-history-title">
                      <strong>{formatAvailabilityPeriod(item)}</strong>
                      <span className={`status-badge status-badge-sm ${state.className}`}>{state.label}</span>
                    </div>
                    <p>
                      {days === 1 ? '1 giorno' : `${days} giorni`}
                      {item.note ? ` · ${item.note}` : ''}
                    </p>
                    <small>
                      Inserita {item.createdByName ? `da ${item.createdByName} ` : ''}il {formatDateTime(item.createdAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn-icon btn-icon-danger"
                    aria-label={`Rimuovi indisponibilità ${formatAvailabilityPeriod(item)}`}
                    onClick={() => setRemoveItem(item)}
                    disabled={busy}
                  >
                    ×
                  </button>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );
}
