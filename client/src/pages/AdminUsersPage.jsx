import { useEffect, useState } from 'react';
import { currentSportSeason } from '../../../shared/reportTemplate.js';
import { api, ApiError } from '../lib/api.js';
import { useCompetitions } from '../lib/competitions.jsx';
import Select from '../components/Select.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import UserAccessModal from '../components/UserAccessModal.jsx';
import { navigate } from '../lib/navigation.js';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, can, hasRole, normalizeRoles } from '../../../shared/permissions.js';

const emptyNewUser = {
  username: '',
  displayName: '',
  roles: ['observer'],
  instructorAssignments: []
};

const emptyEditForm = {
  displayName: '',
  roles: ['observer'],
  active: true,
  instructorAssignments: []
};

// Un utente può avere più ruoli e i permessi si sommano. L'arbitro non compare
// tra le opzioni: è esclusivo e nasce dal collegamento con l'anagrafica.
const ROLE_OPTIONS = ['observer', 'instructor', 'operator', 'admin'];

const ROLE_BADGE_CLASS = {
  admin: 'status-final',
  instructor: 'status-draft',
  referee: 'status-draft',
  operator: 'status-info',
  observer: ''
};

function UserRolesBadges({ roles = [] }) {
  const list = roles.length ? roles : ['observer'];
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {list.map((role) => (
        <span key={role} className={`status-badge status-badge-sm ${ROLE_BADGE_CLASS[role] || ''}`}>
          {ROLE_LABELS[role] || role}
        </span>
      ))}
    </div>
  );
}

function RoleChecklist({ value = [], onChange, disabled = false }) {
  function toggle(role) {
    const next = value.includes(role) ? value.filter((item) => item !== role) : [...value, role];
    onChange(normalizeRoles(next.length ? next : ['observer']));
  }

  return (
    <div className="role-checklist">
      {ROLE_OPTIONS.map((role) => (
        <label key={role} className={`role-option${value.includes(role) ? ' is-selected' : ''}`}>
          <input
            type="checkbox"
            checked={value.includes(role)}
            onChange={() => toggle(role)}
            disabled={disabled}
          />
          <span>
            <strong>{ROLE_LABELS[role]}</strong>
            <small>{ROLE_DESCRIPTIONS[role]}</small>
          </span>
        </label>
      ))}
    </div>
  );
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [accessUser, setAccessUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [openActionsId, setOpenActionsId] = useState(null);
  const [userToToggle, setUserToToggle] = useState(null);
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
    if (can(currentUser, 'users:manage')) {
      loadUsers();
    } else {
      setLoading(false);
    }
  }, [currentUser.role, currentUser.roles]);

  function updateNewUser(field, value) {
    setNewUser((previous) => ({
      ...previous,
      [field]: value,
      // Le assegnazioni servono solo al formatore: compaiono e spariscono con
      // la spunta del ruolo.
      ...(field === 'roles' && !value.includes('instructor') ? { instructorAssignments: [] } : {}),
      ...(field === 'roles' && value.includes('instructor') && previous.instructorAssignments.length === 0
        ? { instructorAssignments: [defaultAssignment()] }
        : {})
    }));
  }

  function updateEditForm(field, value) {
    setEditForm((previous) => ({
      ...previous,
      [field]: value,
      // Le assegnazioni servono solo al formatore: compaiono e spariscono con
      // la spunta del ruolo.
      ...(field === 'roles' && !value.includes('instructor') ? { instructorAssignments: [] } : {}),
      ...(field === 'roles' && value.includes('instructor') && previous.instructorAssignments.length === 0
        ? { instructorAssignments: [defaultAssignment()] }
        : {})
    }));
  }

  function updateUserPayload(user, updates = {}) {
    return {
      displayName: user.displayName,
      roles: user.roles?.length ? user.roles : [user.role],
      instructorAssignments: instructorAssignments(user),
      active: user.active,
      ...updates
    };
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newUser.roles.includes('instructor') && !validAssignments(newUser.instructorAssignments)) {
      setError('Completa almeno una stagione e un campionato per il formatore.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createUser({
        ...newUser,
        instructorAssignments: newUser.roles.includes('instructor') ? newUser.instructorAssignments : []
      });
      setNewUser(emptyNewUser);
      setShowCreateModal(false);
      setSuccess('Profilo creato. Puoi generare un invito per abilitare l’accesso.');
      setAccessUser(result.user);
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
      roles: user.roles?.length ? user.roles : [user.role],
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
    if (editForm.roles.includes('instructor') && !validAssignments(editForm.instructorAssignments)) {
      setError('Completa almeno una stagione e un campionato per il formatore.');
      return;
    }
    setBusy(true);
    try {
      await api.updateUser(editUser.id, updateUserPayload(editUser, {
        displayName: editForm.displayName,
        roles: editForm.roles,
        active: editUser.id === currentUser.id ? true : editForm.active,
        instructorAssignments: editForm.roles.includes('instructor') ? editForm.instructorAssignments : []
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

  function handleToggleActive(user) {
    if (user.id === currentUser.id) {
      setError('Per sicurezza non puoi disattivare il tuo utente mentre sei collegato.');
      return;
    }
    setOpenActionsId(null);
    setUserToToggle(user);
  }

  async function confirmToggleActive() {
    const user = userToToggle;
    if (!user) return;
    setUserToToggle(null);
    setError('');
    setSuccess('');
    try {
      await api.updateUser(user.id, updateUserPayload(user, { active: !user.active }));
      setSuccess(user.active ? 'Utente disattivato.' : 'Utente riattivato.');
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cambio stato non riuscito.');
    }
  }

  if (!can(currentUser, 'users:manage')) {
    return (
      <div className="empty-state">
        <h2>Area riservata agli admin</h2>
        <p>Qui si gestiscono utenti e password dell'applicativo.</p>
      </div>
    );
  }

  return (
    <div className="page-stack">
      {userToToggle ? (
        <ConfirmModal
          title={userToToggle.active ? 'Disattiva utente' : 'Riattiva utente'}
          confirmLabel={userToToggle.active ? 'Sì, disattiva' : 'Sì, riattiva'}
          confirmClassName={userToToggle.active ? 'danger-button' : 'primary-button'}
          onConfirm={confirmToggleActive}
          onCancel={() => setUserToToggle(null)}
        >
          {userToToggle.active ? 'Disattivare' : 'Riattivare'} l'utente <strong>{userToToggle.username}</strong>?
        </ConfirmModal>
      ) : null}
      {showCreateModal ? (
        <Modal title="Crea nuova utenza" onClose={() => setShowCreateModal(false)}>
          <form className="modal-form" onSubmit={handleCreateUser}>
            {error ? <div className="error-banner" role="alert">{error}</div> : null}
            <p>Scegli username e ruoli. La persona imposterà le proprie credenziali dall’invito; puoi lasciare il profilo senza accesso.</p>
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
            <div className="field">
              <span>Ruoli</span>
              <RoleChecklist value={newUser.roles} onChange={(value) => updateNewUser('roles', value)} />
            </div>
            {newUser.roles.includes('instructor') ? (
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

      {accessUser ? <UserAccessModal user={accessUser} onClose={() => setAccessUser(null)} onChanged={loadUsers} /> : null}

      {editUser ? (
        <Modal title={`Modifica ${editUser.username}`} onClose={() => setEditUser(null)}>
          <form className="modal-form" onSubmit={handleEditUser}>
            {error ? <div className="error-banner" role="alert">{error}</div> : null}
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
            <div className="field">
              <span>Ruoli</span>
              {hasRole(editUser, 'referee') ? (
                <p style={{ color: 'var(--muted)', margin: 0 }}>
                  Utenza arbitro: è un ruolo esclusivo e non si combina con gli altri.
                </p>
              ) : (
                <RoleChecklist value={editForm.roles} onChange={(value) => updateEditForm('roles', value)} />
              )}
            </div>
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
            {editForm.roles.includes('instructor') ? (
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
          <p>Crea i profili, assegna i ruoli e consegna i link personali di attivazione.</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="ghost-button" onClick={() => navigate('/account')}>
            Cambia password
          </button>
          <button type="button" className="primary-button" onClick={() => setShowCreateModal(true)}>
            + Crea utente
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

        {loading ? <div className="empty-state">Caricamento utenti…</div> : null}
        {!loading ? (
          <div className="table-scroll">
            <table className="referee-table users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Nome</th>
                  <th>Ruolo</th>
                  <th>Stato</th>
                  <th>Accesso</th>
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
                    <td><UserRolesBadges roles={user.roles} /></td>
                    <td><UserStatusBadge active={user.active} /></td>
                    <td><span className="status-badge status-badge-sm">{user.hasPassword || user.hasGoogle ? [user.hasPassword && 'Password', user.hasGoogle && 'Google'].filter(Boolean).join(' + ') : user.pendingInvitation ? 'Invitato' : 'Da attivare'}</span></td>
                    <td>
                      {hasRole(user, 'instructor')
                        ? formatAssignments(instructorAssignments(user), competitionLabel)
                        : hasRole(user, 'referee')
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
                          className="btn-icon"
                          aria-label={`Azioni utente ${user.username}`}
                          onClick={() => setOpenActionsId((current) => current === user.id ? null : user.id)}
                        >
                          ☰
                        </button>
                        {openActionsId === user.id ? (
                          <div className="row-menu-dropdown">
                            {can(user, 'reports:write') && !hasRole(user, 'referee') ? (
                              <button type="button" onClick={() => navigate(`/observers/${user.id}`)}>Indisponibilità</button>
                            ) : null}
                            <button type="button" onClick={() => openEditModal(user)}>Modifica</button>
                            <button type="button" onClick={() => { setAccessUser(user); setOpenActionsId(null); }}>Inviti e accesso</button>
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
