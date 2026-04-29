import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    <main className="login-page">
      <section className="login-art">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="login-card">
          <div className="brand login-brand">
            <span className="brand-mark">RA</span>
            <span>
              <strong>Rapporti Arbitrali</strong>
              <small>Compila, archivia, esporta</small>
            </span>
          </div>
          <h1>Entra nel tuo taccuino gara.</h1>
          <p>
            Un posto ordinato per trasformare appunti, valutazioni e giudizi in PDF pronti da condividere.
          </p>
        </div>
      </section>

      <section className="login-panel">
        <form onSubmit={handleSubmit} className="auth-box">
          <p className="eyebrow">Accesso riservato</p>
          <h2>Login</h2>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </label>
          {error ? <div className="error-banner">{error}</div> : null}
          <button className="primary-button full-button" type="submit" disabled={loading}>
            {loading ? 'Accesso...' : 'Entra'}
          </button>
        </form>
      </section>
    </main>
  );
}
