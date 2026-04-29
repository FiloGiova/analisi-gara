import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

const emptyNewUser = {
  username: '',
  displayName: '',
  password: '',
  role: 'user'
};

const emptyPasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
};

function UserRoleBadge({ role }) {
  return <span className={`status-badge ${role === 'admin' ? 'status-final' : 'status-draft'}`}>{role === 'admin' ? 'Admin' : 'Utente'}</span>;
}

function UserStatusBadge({ active }) {
  return <span className={`status-badge ${active ? 'status-final' : 'status-draft'}`}>{active ? 'Attivo' : 'Disattivo'}</span>;
}

export default function AdminUsersPage({ currentUser, onPasswordChanged }) {
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listUsers();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare gli utenti.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser.role === 'admin') {
      loadUsers();
    } else {
      setLoading(false);
    }
  }, [currentUser.role]);

  function updateNewUser(field, value) {
    setNewUser((previous) => ({ ...previous, [field]: value }));
  }

  function updatePasswordForm(field, value) {
    setPasswordForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('Le due nuove password non coincidono.');
      return;
    }

    setBusy(true);
    try {
      await api.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordForm(emptyPasswordForm);
      setSuccess('Password aggiornata. Ti riporto al login per rientrare con quella nuova.');
      window.setTimeout(onPasswordChanged, 900);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cambio password non riuscito.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api.createUser(newUser);
      setNewUser(emptyNewUser);
      setSuccess('Utente creato. Puoi comunicargli username e password iniziale.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Creazione utente non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameUser(user) {
    const displayName = window.prompt('Nome visualizzato', user.displayName || user.username);
    if (displayName === null) return;

    setError('');
    setSuccess('');
    try {
      await api.updateUser(user.id, {
        displayName,
        role: user.role,
        active: user.active
      });
      setSuccess('Nome utente aggiornato.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aggiornamento non riuscito.');
    }
  }

  async function handleToggleRole(user) {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    const ok = window.confirm(`Impostare ${user.username} come ${nextRole === 'admin' ? 'admin' : 'utente semplice'}?`);
    if (!ok) return;

    setError('');
    setSuccess('');
    try {
      await api.updateUser(user.id, {
        displayName: user.displayName,
        role: nextRole,
        active: user.active
      });
      setSuccess('Ruolo aggiornato.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cambio ruolo non riuscito.');
    }
  }

  async function handleToggleActive(user) {
    if (user.id === currentUser.id) {
      setError('Per sicurezza non puoi disattivare il tuo utente mentre sei collegato.');
      return;
    }

    const ok = window.confirm(`${user.active ? 'Disattivare' : 'Riattivare'} ${user.username}?`);
    if (!ok) return;

    setError('');
    setSuccess('');
    try {
      await api.updateUser(user.id, {
        displayName: user.displayName,
        role: user.role,
        active: !user.active
      });
      setSuccess(user.active ? 'Utente disattivato.' : 'Utente riattivato.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cambio stato non riuscito.');
    }
  }

  async function handleResetPassword(user) {
    const password = window.prompt(`Nuova password temporanea per ${user.username}`);
    if (password === null) return;

    setError('');
    setSuccess('');
    try {
      await api.resetUserPassword(user.id, password);
      setSuccess("Password reimpostata. Le sessioni di quell'utente sono state chiuse.");
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset password non riuscito.');
    }
  }

  if (currentUser.role !== 'admin') {
    return (
      <div className="empty-state">
        <h2>Area riservata agli admin</h2>
        <p>Qui si gestiscono utenti e password dell'applicativo.</p>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione</p>
          <h1>Utenti, password e accessi.</h1>
          <p>
            Gestisci le utenze locali dei colleghi senza registrazione pubblica. Le password restano hashate nel database SQLite.
          </p>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="admin-grid">
        <form className="common-card admin-panel" onSubmit={handleChangePassword}>
          <div className="section-heading">
            <div>
              <h2>Cambia la tua password</h2>
              <p>Dopo il salvataggio dovrai rientrare con la nuova password.</p>
            </div>
          </div>

          <label className="field">
            Password attuale
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => updatePasswordForm('currentPassword', event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            Nuova password
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => updatePasswordForm('newPassword', event.target.value)}
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
              onChange={(event) => updatePasswordForm('confirmPassword', event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <button type="submit" className="primary-button full-button" disabled={busy}>
            Aggiorna password
          </button>
        </form>

        <form className="common-card admin-panel" onSubmit={handleCreateUser}>
          <div className="section-heading">
            <div>
              <h2>Crea nuova utenza</h2>
              <p>Per colleghi osservatori o altri amministratori.</p>
            </div>
          </div>

          <label className="field">
            Username
            <input
              value={newUser.username}
              onChange={(event) => updateNewUser('username', event.target.value)}
              placeholder="es. mrossi"
              autoComplete="off"
              required
            />
          </label>
          <label className="field">
            Nome visualizzato
            <input
              value={newUser.displayName}
              onChange={(event) => updateNewUser('displayName', event.target.value)}
              placeholder="Mario Rossi"
              autoComplete="off"
            />
          </label>
          <label className="field">
            Password iniziale
            <input
              type="password"
              value={newUser.password}
              onChange={(event) => updateNewUser('password', event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="field">
            Ruolo
            <select value={newUser.role} onChange={(event) => updateNewUser('role', event.target.value)}>
              <option value="user">Utente</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="primary-button full-button" disabled={busy}>
            Crea utente
          </button>
        </form>
      </section>

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Utenti locali</h2>
            <p>Reset password, ruoli e attivazione. Le sessioni vengono chiuse quando resetti una password o disattivi un utente.</p>
          </div>
        </div>

        {loading ? <div className="empty-state">Caricamento utenti...</div> : null}
        {!loading ? (
          <div className="users-list">
            {users.map((user) => (
              <article className={`user-row ${user.active ? '' : 'is-disabled'}`} key={user.id}>
                <div>
                  <span className="match-number">{user.username}</span>
                  <h3>{user.displayName || user.username}</h3>
                  <p>Creato il {new Date(user.createdAt).toLocaleDateString('it-IT')}</p>
                </div>
                <div className="user-badges">
                  <UserRoleBadge role={user.role} />
                  <UserStatusBadge active={user.active} />
                </div>
                <div className="card-actions">
                  <button type="button" className="ghost-button" onClick={() => handleRenameUser(user)}>
                    Nome
                  </button>
                  <button type="button" className="ghost-button" onClick={() => handleToggleRole(user)}>
                    {user.role === 'admin' ? 'Rendi utente' : 'Rendi admin'}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => handleResetPassword(user)}>
                    Reset password
                  </button>
                  <button
                    type="button"
                    className={user.active ? 'danger-button' : 'ghost-button'}
                    onClick={() => handleToggleActive(user)}
                    disabled={user.id === currentUser.id}
                  >
                    {user.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
