import { useEffect, useState } from 'react';
import { formatDateTime } from '../lib/formatters.js';
import { api, ApiError } from '../lib/api.js';
import { can } from '../../../shared/permissions.js';

const PAGE_SIZE = 50;

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
      {loading ? <div className="empty-state">Caricamento…</div> : null}
      {!loading && logs.length === 0 ? <div className="empty-state">Nessun accesso registrato.</div> : null}

      {!loading && logs.length > 0 ? (
        <>
          <div className="users-list">
            {logs.map((log) => (
              <article className="user-row" key={log.id}>
                <div>
                  <span className="match-number">{log.username}</span>
                  <h3>{log.display_name || log.username}</h3>
                  <p>{formatDateTime(log.created_at)}</p>
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
      {loading ? <div className="empty-state">Caricamento…</div> : null}
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
                    {formatDateTime(log.created_at)} · {log.role === 'first' ? '1° arbitro' : '2° arbitro'}
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

// Etichette e tono dell'evento: il colore da solo non basta, l'etichetta c'è
// sempre (vedi DESIGN.md).
const REPORT_EVENT_STYLES = {
  created: { label: 'Creato', tone: 'status-info' },
  updated: { label: 'Modificato', tone: 'status-neutral' },
  finalized: { label: 'Definitivo', tone: 'status-final' },
  imported: { label: 'Importato da PDF', tone: 'status-teal' },
  attachment_added: { label: 'Allegato caricato', tone: 'status-neutral' },
  attachment_removed: { label: 'Allegato eliminato', tone: 'status-warning' },
  exported: { label: 'PDF generato', tone: 'status-neutral' },
  email_sent: { label: 'Inviato via email', tone: 'status-final' },
  deleted: { label: 'Cancellato', tone: 'status-cancelled' }
};

function ReportEventsTab() {
  const { logs, total, offset, loading, error, load } = usePagedLogs(api.listReportEvents);

  useEffect(() => {
    load(0);
  }, []);

  return (
    <section className="common-card">
      <div className="section-heading">
        <div>
          <h2>Azioni sui rapporti</h2>
          <p>
            Creazione, modifica, import, allegati, PDF, invii e cancellazioni, con l'autore di ciascuna.
            {total > 0 ? ` ${total} azioni registrate.` : ''}
          </p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="empty-state">Caricamento…</div> : null}
      {!loading && logs.length === 0 ? (
        <div className="empty-state">
          Nessuna azione registrata: il log parte dalle azioni successive all'attivazione.
        </div>
      ) : null}

      {!loading && logs.length > 0 ? (
        <>
          <div className="users-list">
            {logs.map((log) => {
              const style = REPORT_EVENT_STYLES[log.event] || { label: log.eventLabel, tone: 'status-neutral' };
              return (
                <article className="user-row" key={log.id}>
                  <div>
                    <span className="match-number">
                      Gara {log.matchNumber || '—'}{log.competition ? ` · ${log.competition}` : ''}
                    </span>
                    <h3>{log.teams || 'Squadre non indicate'}</h3>
                    <p>
                      {formatDateTime(log.createdAt)}
                      {log.actorName ? ` · ${log.actorName}` : ''}
                      {log.actorRole ? ` (${log.actorRole})` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                    <span className={`status-badge ${style.tone}`} style={{ alignSelf: 'flex-start' }}>
                      {style.label}
                    </span>
                    {log.reportType === 'video' ? (
                      <span className="status-badge status-badge-sm status-info" style={{ alignSelf: 'flex-start' }}>VIDEO</span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center', fontSize: '0.85rem', color: 'var(--muted)' }}>
                    <span>{log.observerName ? `Osservatore: ${log.observerName}` : 'Osservatore non indicato'}</span>
                    <span>{log.referees || '—'}</span>
                    {log.details ? <span>{log.details}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination total={total} offset={offset} onPage={load} />
        </>
      ) : null}
    </section>
  );
}

export default function AdminLogsPage({ currentUser }) {
  const [tab, setTab] = useState('access');

  if (!can(currentUser, 'logs:view')) {
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
          <p>Accessi all'applicazione, azioni sui rapporti e invii email, con autore ed esito.</p>
        </div>
      </section>

      <section className="toolbar-card">
        <div className="view-switch">
          <button type="button" className={tab === 'access' ? 'is-active' : ''} onClick={() => setTab('access')}>
            Accessi
          </button>
          <button type="button" className={tab === 'reports' ? 'is-active' : ''} onClick={() => setTab('reports')}>
            Rapporti
          </button>
          <button type="button" className={tab === 'email' ? 'is-active' : ''} onClick={() => setTab('email')}>
            Email
          </button>
        </div>
      </section>

      {tab === 'access' ? <AccessLogsTab /> : tab === 'reports' ? <ReportEventsTab /> : <EmailLogsTab />}
    </div>
  );
}
