import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

const EVENT_LABELS = {
  activation_created: 'Invito generato', activation_completed: 'Account attivato con password',
  recovery_created: 'Recupero generato', recovery_completed: 'Password recuperata',
  links_revoked: 'Link revocati', google_activated: 'Account attivato con Google',
  google_linked: 'Google collegato', google_unlinked: 'Google scollegato', google_login: 'Accesso Google',
  password_changed: 'Password modificata', email_changed: 'Email modificata',
  verify_email_created: 'Verifica email richiesta', email_verified: 'Email verificata',
  email_delivery_failed: 'Invio email non riuscito'
};

export default function UserAccessModal({ user, onClose, onChanged }) {
  const [invitation, setInvitation] = useState(null);
  const [pending, setPending] = useState(user.pendingInvitation || null);
  const [resetGoogle, setResetGoogle] = useState(false);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const activated = user.hasPassword || user.hasGoogle;
  async function history() { setEvents((await api.userAuthEvents(user.id)).events); }
  useEffect(() => { history().catch((err) => setError(err.message)); }, [user.id]);
  async function generate() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api.createInvitation(user.id, { kind: activated ? 'recovery' : 'activation', resetGoogle });
      setInvitation(data.invitation); setPending({ expires_at: data.invitation.expiresAt });
      await onChanged(); await history();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setError('');
    try {
      await api.revokeInvitation(user.id); setInvitation(null); setPending(null);
      setMessage('Link revocati.'); await onChanged(); await history();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Accesso di ${user.username}`} onClose={() => { if (!busy) onClose(); }}>
    <div className="access-modal-content">
      <p><strong>{user.displayName}</strong> · {activated ? 'Account attivato' : 'Profilo anagrafico, accesso da attivare'}</p>
      <p>{activated ? 'Consegna un link personale per scegliere una nuova password. Al suo utilizzo tutte le sessioni verranno chiuse.' : 'Genera un invito e consegnalo alla persona. Sceglierà la password oppure Google, senza che tu debba conoscere la sua email.'}</p>
      {activated && user.hasGoogle ? <label className="auth-checkbox"><input type="checkbox" checked={resetGoogle} onChange={(e) => setResetGoogle(e.target.checked)} disabled={busy} /><span>Rimuovi anche il collegamento Google quando il recupero viene completato.</span></label> : null}
      {pending ? <p className="auth-help">Link valido fino al {new Date(pending.expires_at).toLocaleString('it-IT')}. Generarne un altro rende inutilizzabile il precedente.</p> : null}
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {message ? <div className="success-banner" role="status">{message}</div> : null}
      {invitation ? <div className="auth-form">
        <label className="field">Link personale da consegnare<textarea rows={3} readOnly value={invitation.url} onFocus={(e) => e.target.select()} /></label>
        <button type="button" className="primary-button" onClick={async () => {
          try { await navigator.clipboard.writeText(invitation.url); setMessage('Link copiato. Consegna questo link solo alla persona indicata.'); }
          catch { setMessage('Seleziona e copia manualmente il link nel campo qui sopra.'); }
        }}>Copia link</button>
        <p className="auth-help">Il link completo è visibile solo ora. Dopo aver chiuso questa finestra potrai revocarlo o generarne uno nuovo.</p>
      </div> : null}
      <div className="toolbar-actions">
        <button type="button" className="primary-button" disabled={busy || !user.active} onClick={generate}>{busy ? 'Operazione in corso…' : pending ? 'Genera nuovo link' : activated ? 'Genera link di recupero' : 'Genera invito'}</button>
        {pending ? <button type="button" className="danger-button" disabled={busy} onClick={revoke}>Revoca link</button> : null}
      </div>
      {!user.active ? <p className="auth-help">Riattiva prima il profilo per generare un link.</p> : null}
      <div className="account-security-section"><h3>Ultime operazioni</h3>
        {events.length ? <ol className="auth-event-list">{events.map((event, index) => <li key={index}><strong>{EVENT_LABELS[event.action] || event.action}</strong><span>{new Date(event.created_at).toLocaleString('it-IT')}{event.actor ? ` · ${event.actor}` : ''}</span></li>)}</ol> : <p>Nessuna operazione di attivazione registrata.</p>}
      </div>
    </div>
  </Modal>;
}
