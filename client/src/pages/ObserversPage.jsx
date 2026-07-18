import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { formatDate } from '../lib/formatters.js';
import FilterBar from '../components/FilterBar.jsx';
import ListSkeleton from '../components/ListSkeleton.jsx';
import UserAvatar from '../components/UserAvatar.jsx';

export default function ObserversPage({ currentUser }) {
  const canManage = currentUser.role === 'admin' || currentUser.role === 'instructor';
  const [observers, setObservers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    api.listObservers()
      .then((data) => setObservers(data.observers || []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossibile caricare gli osservatori.'))
      .finally(() => setLoading(false));
  }, [canManage]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('it');
    if (!term) return observers;
    return observers.filter((observer) => (
      `${observer.displayName} ${observer.username}`.toLocaleLowerCase('it').includes(term)
    ));
  }, [observers, search]);

  if (!canManage) {
    return (
      <div className="empty-state">
        <h2>Sezione riservata ad admin e formatori</h2>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Anagrafica operativa</p>
          <h1>Osservatori e indisponibilità</h1>
          <p>Apri un osservatore per aggiungere giorni o periodi e consultare lo storico completo, senza vincoli di stagione.</p>
        </div>
        <button type="button" className="back-link" onClick={() => navigate('/games/designate')}>
          <span aria-hidden="true">←</span> Torna alle designazioni
        </button>
      </section>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Osservatori ({filtered.length})</h2>
            <p>Sono inclusi i formatori che possono essere designati come osservatori.</p>
          </div>
        </div>
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: 'Cerca osservatore…' }}
          activeCount={search ? 1 : 0}
          onReset={() => setSearch('')}
        />
        {loading ? <ListSkeleton rows={5} /> : null}
        {!loading && filtered.length === 0 ? (
          <div className="empty-state availability-empty">
            <h3>Nessun osservatore trovato</h3>
            <p>Prova a modificare la ricerca.</p>
          </div>
        ) : null}
        {!loading && filtered.length ? (
          <div className="observer-directory-list">
            {filtered.map((observer) => (
              <button
                type="button"
                className={`observer-directory-row ${observer.active ? '' : 'is-disabled'}`.trim()}
                key={observer.id}
                onClick={() => navigate(`/observers/${observer.id}`)}
              >
                <UserAvatar photoPath={observer.photoPath} name={observer.displayName} size={44} />
                <span className="observer-directory-identity">
                  <strong>{observer.displayName}</strong>
                  <small>@{observer.username} · {observer.role === 'instructor' ? 'Formatore' : 'Osservatore'}</small>
                </span>
                <span className="observer-directory-availability">
                  {observer.nextUnavailableFrom ? (
                    <>
                      <span className="status-badge status-badge-sm status-alert">
                        {observer.currentlyUnavailable ? 'Indisponibile oggi' : 'Indisponibilità programmata'}
                      </span>
                      <small>
                        {observer.currentlyUnavailable ? 'periodo iniziato il' : 'prossimo periodo dal'} {formatDate(observer.nextUnavailableFrom)}
                      </small>
                    </>
                  ) : (
                    <>
                      <span className="status-badge status-badge-sm status-final">Nessun periodo futuro</span>
                      <small>{observer.unavailabilityCount} nello storico</small>
                    </>
                  )}
                </span>
                <span className="observer-directory-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
