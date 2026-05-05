import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

const PAGE_SIZE = 50;

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function parseUserAgent(ua) {
  if (!ua) return '—';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Linux')) return 'Linux';
  return ua.slice(0, 40);
}

export default function AdminLogsPage({ currentUser }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadLogs(newOffset = 0) {
    setLoading(true);
    setError('');
    try {
      const data = await api.listAccessLogs(PAGE_SIZE, newOffset);
      setLogs(data.logs);
      setTotal(data.total);
      setOffset(newOffset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare i log.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser.role === 'admin') {
      loadLogs(0);
    } else {
      setLoading(false);
    }
  }, [currentUser.role]);

  if (currentUser.role !== 'admin') {
    return (
      <div className="empty-state">
        <h2>Area riservata agli admin</h2>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione</p>
          <h1>Log accessi</h1>
          <p>
            Ogni accesso riuscito viene registrato con utente, orario e indirizzo IP.
            {total > 0 ? ` ${total} accessi totali registrati.` : ''}
          </p>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Accessi recenti</h2>
            <p>Ordinati dal più recente. Solo login completati con successo.</p>
          </div>
        </div>

        {loading ? <div className="empty-state">Caricamento...</div> : null}

        {!loading && logs.length === 0 ? (
          <div className="empty-state">Nessun accesso registrato.</div>
        ) : null}

        {!loading && logs.length > 0 ? (
          <>
            <div className="users-list">
              {logs.map((log) => (
                <article className="user-row" key={log.id}>
                  <div>
                    <span className="match-number">{log.username}</span>
                    <h3>{log.display_name || log.username}</h3>
                    <p>{formatDate(log.created_at)}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                    <span className="status-badge status-final" style={{ alignSelf: 'flex-start' }}>Login</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center', fontSize: '0.85rem', color: 'var(--muted)' }}>
                    <span>IP: {log.ip_address || '—'}</span>
                    <span>{parseUserAgent(log.user_agent)}</span>
                  </div>
                </article>
              ))}
            </div>

            {totalPages > 1 ? (
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', paddingTop: '16px' }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => loadLogs(offset - PAGE_SIZE)}
                  disabled={currentPage === 1}
                >
                  ← Precedenti
                </button>
                <span style={{ lineHeight: '36px', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => loadLogs(offset + PAGE_SIZE)}
                  disabled={currentPage === totalPages}
                >
                  Successivi →
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
