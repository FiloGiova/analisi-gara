import { useState } from 'react';
import AuthLayout from '../components/AuthLayout.jsx';
import { api, ApiError } from '../lib/api.js';

export default function LoginPage({ onLogin, features }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recover, setRecover] = useState(false);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  async function handleGoogle() {
    setLoading(true); setError('');
    try { window.location.assign((await api.startGoogle({ purpose: 'login' })).url); }
    catch (err) { setError(err.message); setLoading(false); }
  }

  async function handleRecovery(event) {
    event.preventDefault(); setLoading(true); setError('');
    try { setNotice((await api.recoverAccount(email)).message); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.login(username, password);
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Accesso non riuscito.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
        <div className="auth-box">
        <form onSubmit={handleSubmit} className="auth-form">
          <p className="eyebrow">Accesso riservato</p>
          <h2>Login</h2>
          <label>
            Username o email verificata
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          <button className="primary-button full-button" type="submit" disabled={loading}>
            {loading ? 'Accesso...' : 'Entra'}
          </button>
        </form>
        {features.googleAuth ? <button className="ghost-button full-button google-button" type="button" disabled={loading} onClick={handleGoogle}>Continua con Google</button> : null}
        <p className="auth-help">Al primo accesso apri il link personale ricevuto dall’amministratore. Google funziona dopo l’attivazione o il collegamento dal tuo account.</p>
        <button type="button" className="ghost-button full-button" onClick={() => setRecover(!recover)} aria-expanded={recover}>Password dimenticata?</button>
        {recover ? <div className="auth-form">
          <p className="auth-help">Chiedi un link di recupero all’amministratore: funziona anche senza email.</p>
          {features.emailDelivery ? <form className="auth-form" onSubmit={handleRecovery}>
            <label>Email verificata<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
            <button type="submit" className="primary-button" disabled={loading}>Invia link di recupero</button>
          </form> : null}
          {notice ? <p className="success-banner" role="status">{notice}</p> : null}
        </div> : null}
        </div>
    </AuthLayout>
  );
}
