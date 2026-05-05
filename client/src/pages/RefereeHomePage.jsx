import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import StatusBadge from '../components/StatusBadge.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import RefereeProgressDashboard from '../components/RefereeProgressDashboard.jsx';

const CURRENT_SEASON = currentSportSeason();

function formatDate(value) {
  if (!value) return '-';
  try { return new Date(value).toLocaleDateString('it-IT'); } catch { return value; }
}

export default function RefereeHomePage({ currentUser }) {
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [season, setSeason] = useState(CURRENT_SEASON);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.myReports({ season }),
      api.myStats({ season })
    ])
      .then(([rep, st]) => {
        setReports(rep.reports || []);
        setStats(st.stats || null);
      })
      .catch((err) => setError(err.message || 'Errore di caricamento.'))
      .finally(() => setLoading(false));
  }, [season]);

  return (
    <div className="page-stack">
      <section className="dashboard-hero referee-hero">
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <UserAvatar
            photoPath={currentUser.photoPath}
            name={currentUser.displayName || currentUser.username}
            size={88}
            ring
          />
          <div>
            <p className="eyebrow">Area arbitro</p>
            <h1>Ciao, {currentUser.displayName || currentUser.username}</h1>
            <p>I tuoi rapporti della stagione {season}. Apri un rapporto per leggerne i dettagli.</p>
            {stats ? (
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
                <span className="status-badge" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                  Rapporti: {stats.total ?? 0}
                </span>
                {stats.final !== undefined ? (
                  <span className="status-badge" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                    Definitivi: {stats.final ?? 0}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <RefereeProgressDashboard refereeId={currentUser.refereeId} season={season} />

      <section className="reports-grid">
        {loading ? <div className="empty-state">Caricamento rapporti...</div> : null}
        {!loading && reports.length === 0 ? (
          <div className="empty-state">
            <h3>Nessun rapporto in questa stagione.</h3>
            <p>I rapporti compilati dai formatori e osservatori per le tue gare appariranno qui.</p>
          </div>
        ) : null}

        {reports.map((report) => (
          <article
            className="report-card"
            key={report.id}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/reports/${report.id}`)}
          >
            <div className="report-card-top">
              <div>
                <span className="match-number">Gara {report.matchNumber || report.id}</span>
                <h2>{report.teams || 'Squadre non inserite'}</h2>
              </div>
              <StatusBadge status={report.status} />
            </div>
            <dl>
              <div>
                <dt>Data</dt>
                <dd>{formatDate(report.reportDate)}</dd>
              </div>
              <div>
                <dt>Campionato</dt>
                <dd>{report.competition || '-'}</dd>
              </div>
              <div>
                <dt>Risultato</dt>
                <dd>{report.result || '-'}</dd>
              </div>
              <div>
                <dt>Osservatore</dt>
                <dd>{report.observerName || '-'}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}
