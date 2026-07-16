import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import { api, ApiError } from '../lib/api.js';
import { useCompetitions } from '../lib/competitions.jsx';
import Select from '../components/Select.jsx';

const emptyNewUser = {
  username: '',
  displayName: '',
  password: '',
  role: 'observer',
  instructorAssignments: []
};

const emptyPasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
};

const emptyEditForm = {
  displayName: '',
  role: 'observer',
  active: true,
  instructorAssignments: []
};

const ROLE_OPTIONS = [
  { value: 'observer', label: 'Osservatore' },
  { value: 'instructor', label: 'Formatore' },
  { value: 'admin', label: 'Admin' }
];

function UserRoleBadge({ role }) {
  const label = role === 'admin' ? 'Admin' : role === 'instructor' ? 'Formatore' : role === 'referee' ? 'Arbitro' : 'Osservatore';
  const className = role === 'admin' ? 'status-final' : role === 'instructor' || role === 'referee' ? 'status-draft' : '';
  return <span className={`status-badge ${className}`}>{label}</span>;
}

function UserStatusBadge({ active }) {
  return <span className={`status-badge ${active ? 'status-final' : 'status-draft'}`}>{active ? 'Attivo' : 'Disattivo'}</span>;
}

function instructorAssignments(user) {
  if (Array.isArray(user?.instructorAssignments)) return user.instructorAssignments;
  const competitions = Array.isArray(user?.instructorCompetitions)
    ? user.instructorCompetitions
    : [user?.instructorCompetition || user?.formatterCompetition].filter(Boolean);
  return competitions.length ? [{ sportSeason: currentSportSeason(), competitions }] : [];
}

function formatCompetitions(values = [], competitionLabel) {
  return values.length ? values.map(competitionLabel).join(', ') : '-';
}

function formatAssignments(assignments = [], competitionLabel) {
  return assignments.length
    ? assignments.map((assignment) => `${assignment.sportSeason}: ${formatCompetitions(assignment.competitions, competitionLabel)}`).join(' · ')
    : '-';
}

function defaultAssignment() {
  return { sportSeason: currentSportSeason(), competitions: [] };
}

function validAssignments(assignments) {
  return assignments.length > 0 && assignments.every((assignment) => (
    /^\d{4}\/\d{4}$/.test(assignment.sportSeason) && assignment.competitions.length > 0
  ));
}

function Modal({ title, children, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Chiudi</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function CompetitionChoices({ value, onChange }) {
  const { activeCompetitions } = useCompetitions();
  const selected = Array.isArray(value) ? value : [];

  function toggle(competition) {
    if (selected.includes(competition)) {
      onChange(selected.filter((item) => item !== competition));
    } else {
      onChange([...selected, competition]);
    }
  }

  return (
    <div className="competition-checks">
      {activeCompetitions.map((competition) => (
        <label key={competition.value}>
          <input
            type="checkbox"
            checked={selected.includes(competition.value)}
            onChange={() => toggle(competition.value)}
          />
          <span>{competition.label}</span>
        </label>
      ))}
    </div>
  );
}

function InstructorAssignmentsEditor({ value, onChange }) {
  const assignments = Array.isArray(value) ? value : [];

  function update(index, field, nextValue) {
    onChange(assignments.map((assignment, itemIndex) => (
      itemIndex === index ? { ...assignment, [field]: nextValue } : assignment
    )));
  }

  return (
    <div className="instructor-assignments-editor">
      {assignments.map((assignment, index) => (
        <div className="instructor-assignment-row" key={`${index}-${assignment.sportSeason}`}>
          <label className="field">
            Stagione
            <input
              value={assignment.sportSeason}
              onChange={(event) => update(index, 'sportSeason', event.target.value)}
              placeholder="2025/2026"
              pattern="\d{4}/\d{4}"
              required
            />
          </label>
          <div className="field instructor-assignment-competitions">
            <span>Campionati</span>
            <CompetitionChoices
              value={assignment.competitions}
              onChange={(competitions) => update(index, 'competitions', competitions)}
            />
          </div>
          <button
            type="button"
            className="ghost-button instructor-assignment-remove"
            onClick={() => onChange(assignments.filter((_, itemIndex) => itemIndex !== index))}
          >
            Rimuovi
          </button>
        </div>
      ))}
      <button type="button" className="ghost-button" onClick={() => onChange([...assignments, defaultAssignment()])}>
        + Aggiungi stagione
      </button>
    </div>
  );
}

export default function AdminUsersPage({ currentUser, onPasswordChanged }) {
  const { competitionLabel } = useCompetitions();
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [resetPassword, setResetPassword] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [openActionsId, setOpenActionsId] = useState(null);
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
    setNewUser((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'role' && value !== 'instructor' ? { instructorAssignments: [] } : {}),
      ...(field === 'role' && value === 'instructor' && previous.instructorAssignments.length === 0
        ? { instructorAssignments: [defaultAssignment()] }
        : {})
    }));
  }

  function updatePasswordForm(field, value) {
    setPasswordForm((previous) => ({ ...previous, [field]: value }));
  }

  function updateEditForm(field, value) {
    setEditForm((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'role' && value !== 'instructor' ? { instructorAssignments: [] } : {}),
      ...(field === 'role' && value === 'instructor' && previous.instructorAssignments.length === 0
        ? { instructorAssignments: [defaultAssignment()] }
        : {})
    }));
  }

  function updateUserPayload(user, updates = {}) {
    return {
      displayName: user.displayName,
      role: user.role,
      instructorAssignments: instructorAssignments(user),
      active: user.active,
      ...updates
    };
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
      setShowPasswordModal(false);
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
    if (newUser.role === 'instructor' && !validAssignments(newUser.instructorAssignments)) {
      setError('Completa almeno una stagione e un campionato per il formatore.');
      return;
    }
    setBusy(true);
    try {
      await api.createUser({
        ...newUser,
        instructorAssignments: newUser.role === 'instructor' ? newUser.instructorAssignments : []
      });
      setNewUser(emptyNewUser);
      setShowCreateModal(false);
      setSuccess('Utente creato. Puoi comunicargli username e password iniziale.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Creazione utente non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  function openEditModal(user) {
    setEditUser(user);
    setEditForm({
      displayName: user.displayName || user.username,
      role: user.role,
      active: Boolean(user.active),
      instructorAssignments: instructorAssignments(user)
    });
    setOpenActionsId(null);
  }

  async function handleEditUser(event) {
    event.preventDefault();
    if (!editUser) return;

    setError('');
    setSuccess('');
    if (editForm.role === 'instructor' && !validAssignments(editForm.instructorAssignments)) {
      setError('Completa almeno una stagione e un campionato per il formatore.');
      return;
    }
    setBusy(true);
    try {
      await api.updateUser(editUser.id, updateUserPayload(editUser, {
        displayName: editForm.displayName,
        role: editForm.role,
        active: editUser.id === currentUser.id ? true : editForm.active,
        instructorAssignments: editForm.role === 'instructor' ? editForm.instructorAssignments : []
      }));
      setEditUser(null);
      setEditForm(emptyEditForm);
      setSuccess('Utente aggiornato.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aggiornamento utente non riuscito.');
    } finally {
      setBusy(false);
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
    setOpenActionsId(null);
    try {
      await api.updateUser(user.id, updateUserPayload(user, { active: !user.active }));
      setSuccess(user.active ? 'Utente disattivato.' : 'Utente riattivato.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cambio stato non riuscito.');
    }
  }

  function openResetModal(user) {
    setResetUser(user);
    setResetPassword('');
    setOpenActionsId(null);
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    if (!resetUser) return;

    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api.resetUserPassword(resetUser.id, resetPassword);
      setSuccess("Password reimpostata. Le sessioni di quell'utente sono state chiuse.");
      setResetUser(null);
      setResetPassword('');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset password non riuscito.');
    } finally {
      setBusy(false);
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
      {showCreateModal ? (
        <Modal title="Crea nuova utenza" onClose={() => setShowCreateModal(false)}>
          <form className="modal-form" onSubmit={handleCreateUser}>
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
              <Select
                value={newUser.role}
                onChange={(v) => updateNewUser('role', v)}
                options={ROLE_OPTIONS}
              />
            </label>
            {newUser.role === 'instructor' ? (
              <div className="field">
                <span>Storico campionati formatore</span>
                <InstructorAssignmentsEditor
                  value={newUser.instructorAssignments}
                  onChange={(value) => updateNewUser('instructorAssignments', value)}
                />
              </div>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setShowCreateModal(false)}>Annulla</button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Creazione...' : 'Crea utente'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {showPasswordModal ? (
        <Modal title="Cambia la tua password" onClose={() => setShowPasswordModal(false)}>
          <form className="modal-form" onSubmit={handleChangePassword}>
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
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setShowPasswordModal(false)}>Annulla</button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Salvataggio...' : 'Aggiorna password'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {resetUser ? (
        <Modal title={`Reset password ${resetUser.username}`} onClose={() => setResetUser(null)}>
          <form className="modal-form" onSubmit={handleResetPassword}>
            <label className="field">
              Nuova password temporanea
              <input
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setResetUser(null)}>Annulla</button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Reset...' : 'Reset password'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editUser ? (
        <Modal title={`Modifica ${editUser.username}`} onClose={() => setEditUser(null)}>
          <form className="modal-form" onSubmit={handleEditUser}>
            <label className="field">
              Username
              <input value={editUser.username} disabled />
            </label>
            <label className="field">
              Nome visualizzato
              <input
                value={editForm.displayName}
                onChange={(event) => updateEditForm('displayName', event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field">
              Ruolo
              <Select
                value={editForm.role}
                onChange={(value) => updateEditForm('role', value)}
                options={ROLE_OPTIONS}
              />
            </label>
            <label className="field">
              Stato
              <Select
                value={editForm.active ? '1' : '0'}
                onChange={(value) => updateEditForm('active', value === '1')}
                disabled={editUser.id === currentUser.id}
                options={[
                  { value: '1', label: 'Attivo' },
                  { value: '0', label: 'Disattivo' }
                ]}
              />
            </label>
            {editForm.role === 'instructor' ? (
              <div className="field">
                <span>Storico campionati formatore</span>
                <InstructorAssignmentsEditor
                  value={editForm.instructorAssignments}
                  onChange={(value) => updateEditForm('instructorAssignments', value)}
                />
              </div>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setEditUser(null)}>Annulla</button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Salvataggio...' : 'Salva modifiche'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione</p>
          <h1>Utenti, password e accessi.</h1>
          <p>Gestisci utenze locali, ruolo e campionati da formatore.</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="hero-button" onClick={() => setShowCreateModal(true)}>
            + Crea utente
          </button>
          <button type="button" className="ghost-button light-hero-button" onClick={() => setShowPasswordModal(true)}>
            Cambia password
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Utenti locali</h2>
            <p>Le azioni amministrative sono nel menu di ogni riga.</p>
          </div>
        </div>

        {loading ? <div className="empty-state">Caricamento utenti...</div> : null}
        {!loading ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="referee-table users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Nome</th>
                  <th>Ruolo</th>
                  <th>Stato</th>
                  <th>Storico formatore</th>
                  <th>Creato</th>
                  <th>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.active ? '' : 'is-disabled'}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: '0.82rem' }}>
                      {user.username}
                    </td>
                    <td style={{ fontWeight: 600 }}>{user.displayName || user.username}</td>
                    <td><UserRoleBadge role={user.role} /></td>
                    <td><UserStatusBadge active={user.active} /></td>
                    <td>
                      {user.role === 'instructor'
                        ? formatAssignments(instructorAssignments(user), competitionLabel)
                        : user.role === 'referee'
                          ? `Arbitro #${user.refereeId || '-'}`
                          : '-'}
                    </td>
                    <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {new Date(user.createdAt).toLocaleDateString('it-IT')}
                    </td>
                    <td>
                      <div className="row-menu" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="icon-menu-button"
                          aria-label={`Azioni utente ${user.username}`}
                          onClick={() => setOpenActionsId((current) => current === user.id ? null : user.id)}
                        >
                          ☰
                        </button>
                        {openActionsId === user.id ? (
                          <div className="row-menu-dropdown">
                            <button type="button" onClick={() => openEditModal(user)}>Modifica</button>
                            <button type="button" onClick={() => openResetModal(user)}>Reset password</button>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(user)}
                              disabled={user.id === currentUser.id}
                            >
                              {user.active ? 'Disattiva' : 'Riattiva'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
