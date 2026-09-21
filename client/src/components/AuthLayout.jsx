export default function AuthLayout({ children }) {
  return <main className="login-page auth-layout">
      <section className="login-art">
        <div className="login-court-scene" aria-hidden="true">
          <span className="court-line court-line-one" />
          <span className="court-line court-line-two" />
          <span className="court-arc court-arc-one" />
          <span className="court-arc court-arc-two" />
          <span className="court-lane" />
          <span className="court-dot court-dot-one" />
          <span className="court-dot court-dot-two" />
          <span className="court-dot court-dot-three" />
        </div>
        <div className="login-card">
          <div className="brand login-brand">
            <span className="brand-mark">
              <img src="/app-logo.png" alt="" />
            </span>
            <span className="brand-copy">
              <strong className="brand-wordmark"><span>Fischio</span><span>Lab</span></strong>
              <small>Gare, arbitri e rapporti</small>
            </span>
          </div>
          <h1>La stagione arbitrale, tutta in un unico posto.</h1>
          <p>
            Gare, designazioni, arbitri, rapporti e statistiche: FischioLab organizza il lavoro
            quotidiano e mantiene tutto sempre consultabile.
          </p>
        </div>
      </section>

    <section className="login-panel">{children}<nav className="auth-public-links" aria-label="Informazioni pubbliche"><a href="/">FischioLab</a><a href="/privacy">Privacy</a><a href="/termini">Termini di utilizzo</a></nav></section>
  </main>;
}
