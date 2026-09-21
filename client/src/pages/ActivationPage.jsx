import { useEffect, useState } from 'react';
import AuthLayout from '../components/AuthLayout.jsx';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.js';

export default function ActivationPage({ token, currentUser, features, onLogin, onLogout }) {
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    let ignore = false;
    setLoading(true); setError(''); setInvitation(null); setSuccess('');
    api.inspectInvitation(token).then((data) => { if (!ignore) setInvitation(data.invitation); })
      .catch((err) => { if (!ignore) setError(err.message); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [token]);

  async function submit(event) {
    event.preventDefault(); setError('');
    if (password !== confirm) { setError('Le password non coincidono.'); return; }
    setBusy(true);
    try {
      const data = await api.activateAccount({ token, password, email });
      // Elimina il segreto dalla cronologia dopo il consumo.
      window.history.replaceState(null, '', `${window.location.pathname}#/account`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      onLogin(data.user, data.message || 'Account pronto. Puoi entrare con il tuo username e la password scelta.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function google() {
    setBusy(true); setError('');
    try { window.location.assign((await api.startGoogle({ purpose: 'activation', token })).url); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function verifyEmail() {
    setBusy(true); setError('');
    try {
      setSuccess((await api.verifyEmail(token)).message);
      window.history.replaceState(null, '', `${window.location.pathname}#/activate`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <AuthLayout><div className="auth-box">
    <h1>{invitation?.kind === 'recovery' ? 'Recupera il tuo account' : invitation?.kind === 'verify_email' ? 'Verifica la tua email' : 'Benvenuto su FischioLab'}</h1>
    {loading ? <p role="status">Verifica del link in corso…</p> : null}
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {success ? <div className="success-banner" role="status">{success}</div> : null}
    {invitation && !success ? <>
      <p>Questo link è per <strong>{invitation.displayName}</strong>.</p>
      <div className="auth-identity"><span>Il tuo username</span><strong>{invitation.username}</strong></div>
      <p className="auth-help">Valido fino al {new Date(invitation.expiresAt).toLocaleString('it-IT')}.</p>
      {invitation.kind === 'verify_email' ? <button type="button" className="primary-button" disabled={busy} onClick={verifyEmail}>{busy ? 'Verifica…' : 'Conferma la mia email'}</button>
        : currentUser ? <>
          <p>Sei collegato come <strong>{currentUser.username}</strong>. Esci prima di usare il link personale.</p>
          <button type="button" className="primary-button" disabled={busy} onClick={async () => {
            setBusy(true); try { await onLogout(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
          }}>Esci e continua con questo link</button>
        </> : <>
          <p className="auth-help">{invitation.kind === 'recovery' ? 'Scegli una nuova password. Le sessioni precedenti verranno chiuse.' : 'Scegli una password per accedere con lo username assegnato. Email e Google sono facoltativi.'}</p>
          {invitation.resetGoogle ? <p className="auth-help">Questo recupero rimuove anche il collegamento Google: potrai aggiungerlo di nuovo dall’account.</p> : null}
          <form className="auth-form" onSubmit={submit}>
            <input type="text" name="username" value={invitation.username} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-label="Username assegnato" />
            <label>Nuova password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <small>Almeno 8 caratteri.</small>
            <label>Conferma password<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
            {invitation.kind === 'activation' ? <label>Email (facoltativa)<input type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /><small>Lo username funziona subito. Per usare l’email servirà verificarla.</small></label> : null}
            <button type="submit" className="primary-button full-button" disabled={busy}>{busy ? 'Salvataggio…' : invitation.kind === 'recovery' ? 'Salva password ed entra' : 'Attiva account ed entra'}</button>
          </form>
          {invitation.kind === 'activation' && features.googleAuth ? <>
            <div className="auth-divider">oppure</div>
            <button type="button" className="ghost-button full-button google-button" disabled={busy} onClick={google}>Attiva con Google</button>
            <p className="auth-help">Userai lo stesso profilo. Potrai aggiungere una password in seguito.</p>
          </> : null}
        </>}
    </> : null}
    <button type="button" className="ghost-button full-button" onClick={() => navigate(currentUser ? '/account' : '/')}>{currentUser ? 'Vai al tuo account' : 'Vai al login'}</button>
  </div></AuthLayout>;
}
