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

function Pagination({ total, offset, onPage }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', paddingTop: '16px' }}>
      <button
        type="button"
        className="ghost-button"
        onClick={() => onPage(offset - PAGE_SIZE)}
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
        onClick={() => onPage(offset + PAGE_SIZE)}
        disabled={currentPage === totalPages}
      >
        Successivi →
      </button>
    </div>
  );
}

function usePagedLogs(fetcher) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(newOffset = 0) {
    setLoading(true);
    setError('');
    try {
      const data = await fetcher(PAGE_SIZE, newOffset);
      setLogs(data.logs);
      setTotal(data.total);
      setOffset(newOffset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare i log.');
    } finally {
      setLoading(false);
    }
  }

  return { logs, total, offset, loading, error, load };
}

function AccessLogsTab() {
  const { logs, total, offset, loading, error, load } = usePagedLogs(api.listAccessLogs);

  useEffect(() => {
    load(0);
  }, []);

  return (
    <section className="common-card">
      <div className="section-heading">
        <div>
          <h2>Accessi recenti</h2>
          <p>
            Ordinati dal più recente. Solo login completati con successo.
            {total > 0 ? ` ${total} accessi totali registrati.` : ''}
          </p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Caricamento...</div> : null}
      {!loading && logs.length === 0 ? <div className="empty-state">Nessun accesso registrato.</div> : null}

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
          <Pagination total={total} offset={offset} onPage={load} />
        </>
      ) : null}
    </section>
  );
}

function EmailLogsTab() {
  const { logs, total, offset, loading, error, load } = usePagedLogs(api.listEmailLogs);

  useEffect(() => {
    load(0);
  }, []);

  return (
    <section className="common-card">
      <div className="section-heading">
        <div>
          <h2>Email inviate</h2>
          <p>
            Ogni tentativo di invio del rapporto, anche quelli falliti.
            {total > 0 ? ` ${total} invii totali registrati.` : ''}
          </p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Caricamento...</div> : null}
      {!loading && logs.length === 0 ? <div className="empty-state">Nessun invio registrato.</div> : null}

      {!loading && logs.length > 0 ? (
        <>
          <div className="users-list">
            {logs.map((log) => (
              <article className="user-row" key={log.id}>
                <div>
                  <span className="match-number">
                    Gara {log.match_number || '—'}{log.competition ? ` · ${log.competition}` : ''}
                  </span>
                  <h3>{log.recipient}</h3>
                  <p>
                    {formatDate(log.created_at)} · {log.role === 'first' ? '1° arbitro' : '2° arbitro'}
                    {log.sent_by_display_name ? ` · inviata da ${log.sent_by_display_name}` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                  <span
                    className={`status-pill ${log.outcome === 'success' ? 'status-success' : 'status-error'}`}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {log.outcome === 'success' ? 'Inviata' : 'Errore'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  <span>CC: {log.cc || '—'}</span>
                  {log.outcome === 'error' ? (
                    <span style={{ color: 'var(--danger)' }}>{log.error_message || 'Errore sconosciuto'}</span>
                  ) : (
                    <span>{log.report_id ? `Rapporto #${log.report_id}` : 'Rapporto eliminato'}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
          <Pagination total={total} offset={offset} onPage={load} />
        </>
      ) : null}
    </section>
  );
}

export default function AdminLogsPage({ currentUser }) {
  const [tab, setTab] = useState('access');

  if (currentUser.role !== 'admin') {
    return (
      <div className="empty-state">
        <h2>Area riservata agli admin</h2>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione</p>
          <h1>Log</h1>
          <p>Accessi all'applicazione e invii email dei rapporti, con esito e dettagli.</p>
        </div>
      </section>

      <section className="toolbar-card">
        <div className="view-switch">
          <button type="button" className={tab === 'access' ? 'is-active' : ''} onClick={() => setTab('access')}>
            Accessi
          </button>
          <button type="button" className={tab === 'email' ? 'is-active' : ''} onClick={() => setTab('email')}>
            Email
          </button>
        </div>
      </section>

      {tab === 'access' ? <AccessLogsTab /> : <EmailLogsTab />}
    </div>
  );
}
