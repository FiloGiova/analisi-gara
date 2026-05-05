import { useEffect, useState } from 'react';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import Select from '../components/Select.jsx';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';
import PhotoUploader from '../components/PhotoUploader.jsx';
import RefereeProgressDashboard from '../components/RefereeProgressDashboard.jsx';
import UserAvatar from '../components/UserAvatar.jsx';

const CURRENT_SEASON = currentSportSeason();

function formatDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('it-IT'); } catch { return iso; }
}

function InfoItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
  );
}

function canInspectReferees(user) {
  if (user?.role === 'admin') return true;
  if (user?.role !== 'instructor') return false;
  return Boolean(user.instructorCompetitions?.length || user.instructorCompetition);
}

export default function RefereeDetailPage({ id, currentUser }) {
  const [referee, setReferee] = useState(null);
  const [seasons, setSeasons] = useState([CURRENT_SEASON]);
  const [selectedSeason, setSelectedSeason] = useState(CURRENT_SEASON);
  const [error, setError] = useState('');
  const canInspect = canInspectReferees(currentUser);

  useEffect(() => {
    if (!canInspect) return;
    api.listRefereeSeasons()
      .then((data) => setSeasons(Array.from(new Set([CURRENT_SEASON, ...(data.seasons || [])]))))
      .catch(() => setSeasons([CURRENT_SEASON]));
  }, [canInspect]);

  useEffect(() => {
    if (!canInspect) return;
    setError('');
    api.getReferee(id, { season: selectedSeason })
      .then((data) => setReferee(data.referee))
      .catch((err) => setError(err.message || 'Arbitro non trovato.'));
  }, [canInspect, id, selectedSeason]);

  if (!canInspect) return <div className="empty-state"><h2>Sezione arbitri non abilitata</h2></div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!referee) return <div className="empty-state">Caricamento arbitro...</div>;

  const stats = referee.stats || {};
  const reports = referee.reports || [];
  const fullName = `${referee.firstName || ''} ${referee.lastName || ''}`.trim();

  async function handleUploadPhoto(file) {
    const result = await api.uploadRefereePhoto(referee.id, file);
    setReferee((current) => ({ ...current, photoPath: result.photoPath }));
  }

  async function handleDeletePhoto() {
    await api.deleteRefereePhoto(referee.id);
    setReferee((current) => ({ ...current, photoPath: null }));
  }

  return (
    <div className="page-stack">
      <section className="detail-hero">
        <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
          <UserAvatar photoPath={referee.photoPath} name={fullName} size={78} ring />
          <div>
            <p className="eyebrow">{selectedSeason === CURRENT_SEASON ? 'Stagione corrente' : 'Archivio storico'}</p>
            <h1>{referee.lastName} {referee.firstName}</h1>
            <p>{referee.category || 'Categoria non assegnata'} · {selectedSeason}</p>
          </div>
        </div>
        <button type="button" className="hero-button" onClick={() => navigate('/admin/referees')}>
          Torna agli arbitri
        </button>
      </section>

      <section className="toolbar-card">
        <div className="admin-referee-toolbar">
          <Select
            value={selectedSeason}
            onChange={setSelectedSeason}
            placeholder="Stagione"
            options={seasons.map((season) => ({
              value: season,
              label: season === CURRENT_SEASON ? `${season} · corrente` : season
            }))}
          />
        </div>
      </section>

      <section className="detail-meta-card">
        <dl>
          <InfoItem label="Tessera" value={referee.licenseNumber} />
          <InfoItem label="Email" value={referee.email} />
          <InfoItem label="Telefono" value={referee.phone} />
          <InfoItem label="Provincia" value={referee.province} />
          <InfoItem label="Nascita" value={formatDate(referee.birthDate)} />
          <InfoItem label="Scad. certificato" value={formatDate(referee.certificateExpiry)} />
        </dl>
      </section>

      {currentUser.role === 'admin' || currentUser.role === 'instructor' ? (
        <section className="common-card">
          <PhotoUploader
            photoPath={referee.photoPath}
            name={fullName}
            onUpload={handleUploadPhoto}
            onDelete={handleDeletePhoto}
            label="Foto arbitro"
          />
        </section>
      ) : null}

      <section className="metric-grid">
        <div className="metric-card">
          <span>Rapporti</span>
          <strong>{stats.reportsCount || 0}</strong>
        </div>
        <div className="metric-card">
          <span>Voti</span>
          <strong>{stats.votesCount || 0}</strong>
        </div>
        <div className="metric-card">
          <span>Media</span>
          <strong>{stats.averageVote ?? '-'}</strong>
        </div>
      </section>

      <RefereeProgressDashboard refereeId={referee.id} season={selectedSeason} />

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Rapporti ricevuti</h2>
            <p>Collegati all'arbitro nella stagione selezionata.</p>
          </div>
        </div>

        {reports.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            Nessun rapporto collegato in questa stagione.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="referee-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Gara</th>
                  <th>Ruolo</th>
                  <th>Squadre</th>
                  <th>Risultato</th>
                  <th>Osservatore</th>
                  <th>Voto</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={`${report.id}-${report.role}`} className="is-clickable" onClick={() => navigate(`/reports/${report.id}`)}>
                    <td>{formatDate(report.reportDate)}</td>
                    <td style={{ fontWeight: 700 }}>{report.matchNumber || report.id}</td>
                    <td>{report.roleLabel}</td>
                    <td>{report.teams || '-'}</td>
                    <td>{report.result || '-'}</td>
                    <td>{report.observerName || '-'}</td>
                    <td style={{ fontWeight: 800, color: 'var(--blue)' }}>{report.vote || '-'}</td>
                    <td>{report.status === 'final' ? 'Definitivo' : 'Bozza'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Storico categorie</h2>
            <p>Archivio delle assegnazioni per anno sportivo.</p>
          </div>
        </div>
        <div className="history-list">
          {(referee.categoryHistory || []).map((item) => (
            <div key={item.id} className="history-row">
              <strong>{item.sportSeason}</strong>
              <span>{item.category || 'Nessuna categoria'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
