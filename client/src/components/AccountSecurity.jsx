import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AccountSecurity({ features, onSignedOut }) {
  const [account, setAccount] = useState(null);
  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [googlePassword, setGooglePassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    const data = await api.accountSecurity(); setAccount(data); setEmail(data.email);
  }
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);
  async function action(fn) {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="common-card account-security">
    <div className="section-heading"><div><h2>Metodi di accesso</h2><p>Email e Google sono facoltativi. Il tuo username resta lo stesso.</p></div></div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {message ? <div className="success-banner" role="status">{message}</div> : null}
    {!account ? <p role="status">Caricamento metodi di accesso…</p> : <>
      <div className="account-security-section">
        <h3>Google</h3>
        <p>{account.google ? <>Collegato a <strong>{account.google.email}</strong>.</> : 'Nessun account Google collegato.'}</p>
        {(features.googleAuth && !account.google) || (account.google && account.hasPassword) ? <form className="auth-form" onSubmit={(event) => {
          event.preventDefault(); action(async () => {
            if (account.google) { await api.unlinkGoogle(googlePassword); onSignedOut(); }
            else window.location.assign((await api.startGoogle({ purpose: 'link', password: googlePassword })).url);
          });
        }}>
          <label className="field">Password attuale per confermare<input type="password" autoComplete="current-password" required value={googlePassword} onChange={(e) => setGooglePassword(e.target.value)} /></label>
          <button type="submit" className="ghost-button" disabled={busy}>{account.google ? 'Scollega Google ed esci' : 'Collega Google'}</button>
        </form> : null}
        {account.google && !account.hasPassword ? <p className="auth-help">Per scollegare Google, crea prima una password nella sezione qui sotto.</p> : null}
        {!features.googleAuth && !account.google ? <p className="auth-help">Il collegamento Google non è ancora disponibile.</p> : null}
      </div>
      <div className="account-security-section">
        <h3>Email facoltativa</h3>
        <p className="auth-help">{account.emailVerified ? 'Email verificata: puoi usarla al posto dello username.' : 'Finché l’email non è verificata, accedi con lo username o con Google, se collegato.'}</p>
        <form className="auth-form" onSubmit={(event) => {
          event.preventDefault(); action(async () => {
            const result = await api.updateEmail({ email, password: emailPassword });
            await load(); setEmailPassword(''); setMessage(result.message);
          });
        }}>
          <label className="field">Email<input type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /><small>Lascia vuoto per rimuoverla.</small></label>
          {account.hasPassword ? <label className="field">Password attuale per confermare<input type="password" autoComplete="current-password" required value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} /></label> : <p className="auth-help">La modifica richiede un accesso Google effettuato negli ultimi 10 minuti.</p>}
          <div className="toolbar-actions"><button type="submit" className="primary-button" disabled={busy}>Salva email</button>
            {account.email && !account.emailVerified && features.emailDelivery ? <button type="button" className="ghost-button" disabled={busy} onClick={() => action(async () => setMessage((await api.resendEmailVerification()).message))}>Invia verifica</button> : null}
          </div>
        </form>
        {!features.emailDelivery ? <p className="auth-help">L’invio email non è attivo. Puoi salvare l’indirizzo; per recuperare l’accesso chiedi un link all’amministratore.</p> : null}
      </div>
    </>}
  </section>;
}
