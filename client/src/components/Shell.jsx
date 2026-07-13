import { useEffect, useRef, useState } from 'react';
import { navigate } from '../lib/navigation.js';
import UserAvatar from './UserAvatar.jsx';

export default function Shell({ user, onLogout, showBackButton = false, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const instructorCompetitions = user.instructorCompetitions?.length
    ? user.instructorCompetitions
    : [user.instructorCompetition || user.formatterCompetition].filter(Boolean);
  const isReferee = user.role === 'referee';
  // Admin e formatori (con almeno un campionato) vedono le sezioni gestionali
  // (Gare, Statistiche, Arbitri). Gli osservatori no.
  const canSeeManagement = user.role === 'admin' || (user.role === 'instructor' && instructorCompetitions.length > 0);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  function go(path) {
    navigate(path);
    setMenuOpen(false);
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate(isReferee ? '/me' : '/');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        {showBackButton ? (
          <button type="button" className="back-button" onClick={goBack} aria-label="Torna indietro">
            <span aria-hidden="true">←</span>
          </button>
        ) : null}

        <button className="brand" type="button" onClick={() => navigate('/')}>
          <span className="brand-mark">
            <img src="/app-logo.png" alt="" />
          </span>
          <span>
            <strong>FischioLab</strong>
            <small>Valutazioni gara</small>
          </span>
        </button>

        <nav className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => navigate(isReferee ? '/me' : '/')}>
            {isReferee ? 'I miei rapporti' : 'Rapporti'}
          </button>
          {canSeeManagement ? (
            <button type="button" className="ghost-button" onClick={() => navigate('/games')}>
              Gare
            </button>
          ) : null}
          {canSeeManagement ? (
            <button type="button" className="ghost-button" onClick={() => navigate('/coverage')}>
              Statistiche
            </button>
          ) : null}
          {canSeeManagement ? (
            <button type="button" className="ghost-button" onClick={() => navigate('/admin/referees')}>
              Arbitri
            </button>
          ) : null}
          {user.role === 'admin' ? (
            <div className={`admin-menu ${menuOpen ? 'is-open' : ''}`} ref={menuRef}>
              <button
                type="button"
                className="ghost-button admin-menu-trigger"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                Admin
                <span className="admin-menu-caret" aria-hidden="true">▾</span>
              </button>
              {menuOpen ? (
                <div className="admin-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick={() => go('/admin/users')}>
                    Utenti
                  </button>
                  <button type="button" role="menuitem" onClick={() => go('/admin/sources')}>
                    Sorgenti gare
                  </button>
                  <button type="button" role="menuitem" onClick={() => go('/admin/imports')}>
                    Import designazioni
                  </button>
                  <button type="button" role="menuitem" onClick={() => go('/admin/logs')}>
                    Log accessi
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="user-chip">
            <button type="button" className="profile-button" onClick={() => navigate('/account')} aria-label="Apri profilo">
              <UserAvatar photoPath={user.photoPath} name={user.displayName || user.username} size={28} />
              <span>{user.displayName || user.username}</span>
            </button>
            <button type="button" className="logout-button" onClick={onLogout} aria-label="Esci">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 17l5-5-5-5" />
                <path d="M15 12H3" />
                <path d="M13 5V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-1" />
              </svg>
            </button>
          </div>
        </nav>
      </header>

      <main>{children}</main>
    </div>
  );
}
