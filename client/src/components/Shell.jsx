import { navigate } from '../lib/navigation.js';

export default function Shell({ user, onLogout, children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate('/')}>
          <span className="brand-mark">RA</span>
          <span>
            <strong>Rapporti Arbitrali</strong>
            <small>Valutazioni gara</small>
          </span>
        </button>

        <nav className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => navigate('/')}>
            Dashboard
          </button>
          {user.role === 'admin' ? (
            <button type="button" className="ghost-button" onClick={() => navigate('/admin/users')}>
              Amministrazione
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={() => navigate('/reports/new')}>
            Nuovo rapporto
          </button>
          <div className="user-chip">
            <span>{user.displayName || user.username}</span>
            <button type="button" onClick={onLogout}>Logout</button>
          </div>
        </nav>
      </header>

      <main>{children}</main>
    </div>
  );
}
