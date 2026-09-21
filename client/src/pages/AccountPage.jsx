import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useCompetitions } from '../lib/competitions.jsx';
import PhotoUploader from '../components/PhotoUploader.jsx';
import AccountSecurity from '../components/AccountSecurity.jsx';
import { instructorAssignmentsForUser } from '../../../shared/instructorAssignments.js';
import ObserverAvailabilityPanel from '../components/ObserverAvailabilityPanel.jsx';
import { ROLE_LABELS, rolesOf } from '../../../shared/permissions.js';

// Un'utenza può avere più ruoli: si mostrano tutti, altrimenti chi è anche
// operatore non capirebbe da dove arrivano le voci di menu in più.
function rolesLabel(user) {
  const roles = rolesOf(user);
  return roles.length ? roles.map((role) => ROLE_LABELS[role] || role).join(' · ') : 'Osservatore';
}

function formatCompetitions(user, competitionLabel) {
  const assignments = instructorAssignmentsForUser(user);
  if (assignments.length) {
    return assignments
      .map((assignment) => `${assignment.sportSeason}: ${assignment.competitions.map(competitionLabel).join(', ')}`)
      .join(' · ');
  }
  const values = user.instructorCompetitions?.length
    ? user.instructorCompetitions
    : [user.instructorCompetition || user.formatterCompetition].filter(Boolean);
  return values.length ? values.map(competitionLabel).join(', ') : '-';
}

function InfoItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
  );
}

export default function AccountPage({ currentUser, onUserUpdated, onPasswordChanged, features, authNotice }) {
  const { competitionLabel } = useCompetitions();
  const [displayName, setDisplayName] = useState(currentUser.displayName || currentUser.username || '');
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function updatePasswordField(field, value) {
    setPasswordForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSaveProfile(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy('profile');
    try {
      const result = await api.updateMyProfile({ displayName });
      onUserUpdated(result.user);
      setDisplayName(result.user.displayName || result.user.username || '');
      setSuccess('Profilo aggiornato.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aggiornamento profilo non riuscito.');
    } finally {
      setBusy('');
    }
  }

  async function handleUploadPhoto(file) {
    const result = await api.uploadMyPhoto(file);
    onUserUpdated({ ...currentUser, photoPath: result.photoPath });
    setSuccess('Foto profilo aggiornata.');
  }

  async function handleDeletePhoto() {
    await api.deleteMyPhoto();
    onUserUpdated({ ...currentUser, photoPath: null });
    setSuccess('Foto profilo rimossa.');
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('Le due nuove password non coincidono.');
      return;
    }

    setBusy('password');
    try {
      await api.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccess('Password aggiornata. Ti riporto al login per rientrare con quella nuova.');
      window.setTimeout(onPasswordChanged, 900);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cambio password non riuscito.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page-stack">
      <section className="detail-hero">
        <div>
          <p className="eyebrow">Profilo personale</p>
          <h1>{currentUser.displayName || currentUser.username}</h1>
          <p>Gestisci i dati della tua utenza e la password di accesso.</p>
        </div>
        <span className="status-badge status-final">{rolesLabel(currentUser)}</span>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}
      {authNotice ? <div className="success-banner" role="status">{authNotice}</div> : null}

      <section className="detail-meta-card account-meta-card">
        <dl>
          <InfoItem label="Username" value={currentUser.username} />
          <InfoItem label="Nome visualizzato" value={currentUser.displayName} />
          <InfoItem label={rolesOf(currentUser).length > 1 ? 'Ruoli' : 'Ruolo'} value={rolesLabel(currentUser)} />
          {currentUser.role === 'instructor' ? (
            <InfoItem label="Storico campionati" value={formatCompetitions(currentUser, competitionLabel)} />
          ) : null}
          {currentUser.role === 'referee' ? (
            <InfoItem label="ID arbitro collegato" value={currentUser.refereeId} />
          ) : null}
        </dl>
      </section>

      {currentUser.role === 'observer' || currentUser.role === 'instructor' ? (
        <ObserverAvailabilityPanel
          observerId={currentUser.id}
          showDirectoryLink={currentUser.role === 'instructor'}
        />
      ) : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Foto profilo</h2>
            <p>La foto appare nella barra superiore e nella tua area personale.</p>
          </div>
        </div>
        <PhotoUploader
          photoPath={currentUser.photoPath}
          name={currentUser.displayName || currentUser.username}
          onUpload={handleUploadPhoto}
          onDelete={handleDeletePhoto}
          label="La tua foto"
        />
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Dati profilo</h2>
            <p>Il nome visualizzato viene usato nell'interfaccia e nei rapporti creati da te.</p>
          </div>
        </div>
        <form className="modal-form" onSubmit={handleSaveProfile}>
          <label className="field">
            Nome visualizzato
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <div className="modal-actions">
            <button type="submit" className="primary-button" disabled={busy === 'profile'}>
              {busy === 'profile' ? 'Salvataggio...' : 'Salva profilo'}
            </button>
          </div>
        </form>
      </section>

      <AccountSecurity features={features} onSignedOut={onPasswordChanged} />

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>{currentUser.hasPassword ? 'Cambia password' : 'Crea una password'}</h2>
            <p>{currentUser.hasPassword ? 'Conferma la password attuale. Dopo il salvataggio dovrai accedere di nuovo.' : 'Aggiungi l’accesso con username e password. Serve un accesso Google effettuato negli ultimi 10 minuti.'}</p>
          </div>
        </div>
        <form className="modal-form" onSubmit={handleChangePassword}>
          {currentUser.hasPassword ? <label className="field">
            Password attuale
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => updatePasswordField('currentPassword', event.target.value)}
              autoComplete="current-password"
              required
            />
          </label> : null}
          <label className="field">
            Nuova password
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => updatePasswordField('newPassword', event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="field">
            Conferma nuova password
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) => updatePasswordField('confirmPassword', event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <div className="modal-actions">
            <button type="submit" className="primary-button" disabled={busy === 'password'}>
              {busy === 'password' ? 'Aggiornamento…' : currentUser.hasPassword ? 'Cambia password' : 'Crea password'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
