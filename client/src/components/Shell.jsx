import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { navigate } from '../lib/navigation.js';
import UserAvatar from './UserAvatar.jsx';
import SeasonSelector from './SeasonSelector.jsx';

const ICONS = {
  games: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  ),
  coverage: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </svg>
  ),
  referees: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M16.5 8.6a3 3 0 1 1 2.6 4.9" />
      <path d="M17.5 15.2c2.1.4 3.5 1.9 4 4.3" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.8-3.6 3.4-5.6 7-5.6s6.2 2 7 5.6" />
    </svg>
  )
};

const ADMIN_ENTRIES = [
  { path: '/admin/users', label: 'Utenti' },
  { path: '/admin/competitions', label: 'Campionati' },
  { path: '/admin/sources', label: 'Sorgenti gare' },
  { path: '/admin/imports', label: 'Import designazioni' },
  { path: '/admin/logs', label: 'Log' }
];

export default function Shell({
  user,
  onLogout,
  showBackButton = false,
  season,
  seasons,
  onSeasonChange,
  activeSection = '',
  children
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminSheetOpen, setAdminSheetOpen] = useState(false);
  const menuRef = useRef(null);
  const instructorCompetitions = user.instructorCompetitions?.length
    ? user.instructorCompetitions
    : [user.instructorCompetition || user.formatterCompetition].filter(Boolean);
  const isReferee = user.role === 'referee';
  // Admin e formatori (con almeno un campionato) vedono le sezioni gestionali
  // (Gare, Statistiche, Arbitri). Gli osservatori no.
  const canSeeManagement = user.role === 'admin' || (user.role === 'instructor' && instructorCompetitions.length > 0);
  const homePath = isReferee ? '/me' : '/';

  function navClass(section) {
    return `ghost-button topbar-nav-button ${activeSection === section ? 'is-active' : ''}`.trim();
  }

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

  useEffect(() => {
    if (!adminSheetOpen) return undefined;
    function handleKey(e) {
      if (e.key === 'Escape') setAdminSheetOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [adminSheetOpen]);

  function go(path) {
    navigate(path);
    setMenuOpen(false);
    setAdminSheetOpen(false);
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate(homePath);
    }
  }

  // Bottom tab bar mobile: sezioni principali per ruolo, max 5 voci.
  const tabs = [];
  if (canSeeManagement) {
    tabs.push({ section: 'games', label: 'Gare', icon: ICONS.games, onPress: () => go('/') });
    tabs.push({ section: 'reports', label: 'Rapporti', icon: ICONS.reports, onPress: () => go('/reports') });
    tabs.push({ section: 'coverage', label: 'Statistiche', icon: ICONS.coverage, onPress: () => go('/coverage') });
    tabs.push({ section: 'referees', label: 'Arbitri', icon: ICONS.referees, onPress: () => go('/admin/referees') });
    if (user.role === 'admin') {
      tabs.push({ section: 'admin', label: 'Admin', icon: ICONS.admin, onPress: () => setAdminSheetOpen(true) });
    }
  } else {
    tabs.push({
      section: 'reports',
      label: isReferee ? 'I miei rapporti' : 'Rapporti',
      icon: ICONS.reports,
      onPress: () => go(isReferee ? '/me' : '/')
    });
    tabs.push({ section: 'account', label: 'Profilo', icon: ICONS.account, onPress: () => go('/account') });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        {showBackButton ? (
          <button type="button" className="back-button" onClick={goBack} aria-label="Torna indietro">
            <span aria-hidden="true">←</span>
          </button>
        ) : null}

        <button className="brand" type="button" onClick={() => navigate(homePath)}>
          <span className="brand-mark">
            <img src="/app-logo.png" alt="" />
          </span>
          <span className="brand-copy">
            <strong className="brand-wordmark"><span>Fischio</span><span>Lab</span></strong>
            <small>Gare, arbitri e rapporti</small>
          </span>
        </button>

        <SeasonSelector value={season} seasons={seasons} onChange={onSeasonChange} />

        <nav className="topbar-actions">
          {canSeeManagement ? (
            <button
              type="button"
              className={navClass('games')}
              onClick={() => navigate('/')}
              aria-current={activeSection === 'games' ? 'page' : undefined}
            >
              Gare
            </button>
          ) : null}
          <button
            type="button"
            className={navClass('reports')}
            onClick={() => navigate(isReferee ? '/me' : canSeeManagement ? '/reports' : '/')}
            aria-current={activeSection === 'reports' ? 'page' : undefined}
          >
            {isReferee ? 'I miei rapporti' : 'Rapporti'}
          </button>
          {canSeeManagement ? (
            <button
              type="button"
              className={navClass('coverage')}
              onClick={() => navigate('/coverage')}
              aria-current={activeSection === 'coverage' ? 'page' : undefined}
            >
              Statistiche
            </button>
          ) : null}
          {canSeeManagement ? (
            <button
              type="button"
              className={navClass('referees')}
              onClick={() => navigate('/admin/referees')}
              aria-current={activeSection === 'referees' ? 'page' : undefined}
            >
              Arbitri
            </button>
          ) : null}
          {user.role === 'admin' ? (
            <div className={`admin-menu ${menuOpen ? 'is-open' : ''}`} ref={menuRef}>
              <button
                type="button"
                className={`${navClass('admin')} admin-menu-trigger`}
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-current={activeSection === 'admin' ? 'page' : undefined}
              >
                Admin
                <span className="admin-menu-caret" aria-hidden="true">▾</span>
              </button>
              {menuOpen ? (
                <div className="admin-dropdown" role="menu">
                  {ADMIN_ENTRIES.map((entry) => (
                    <button key={entry.path} type="button" role="menuitem" onClick={() => go(entry.path)}>
                      {entry.label}
                    </button>
                  ))}
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

      <nav className="tabbar" aria-label="Sezioni principali">
        {tabs.map((tab) => (
          <button
            key={tab.section}
            type="button"
            className={`tabbar-item ${activeSection === tab.section ? 'is-active' : ''}`.trim()}
            onClick={tab.onPress}
            aria-current={activeSection === tab.section ? 'page' : undefined}
          >
            <span className="tabbar-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {adminSheetOpen
        ? createPortal(
            <div className="sheet-overlay" onClick={() => setAdminSheetOpen(false)}>
              <div
                className="filter-sheet menu-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Sezioni amministrazione"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="filter-sheet-handle" aria-hidden="true" />
                <p className="filter-sheet-title">Amministrazione</p>
                <div className="menu-sheet-list">
                  {ADMIN_ENTRIES.map((entry) => (
                    <button key={entry.path} type="button" onClick={() => go(entry.path)}>
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
