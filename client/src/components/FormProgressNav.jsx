function surname(fullName) {
  if (!fullName?.trim()) return null;
  return fullName.trim().split(/\s+/)[0];
}

function CheckCircle({ state, isActive }) {
  const cls = ['form-nav-check', state, isActive ? 'active-on-dark' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {state === 'done' ? '✓' : null}
    </span>
  );
}

export default function FormProgressNav({ progress, activeSection, activeRole, onNavigate, refereeNames }) {
  const pct = progress.overall.total > 0
    ? Math.round((progress.overall.completed / progress.overall.total) * 100)
    : 0;

  const links = [
    { id: 'section-data',    label: 'Dati gara',                                             key: 'data' },
    { id: 'section-common',  label: 'Caratteristiche',                                       key: 'common' },
    { id: 'section-first',   label: surname(refereeNames?.first)  || '1° Arbitro',           key: 'first',   role: 'first' },
    { id: 'section-first',   label: surname(refereeNames?.second) || '2° Arbitro',           key: 'second',  role: 'second' },
    { id: 'section-closing', label: 'Voti',                                                  key: 'closing' },
  ];

  return (
    <nav className="form-nav" aria-label="Progresso compilazione">
      <div className="form-nav-header">
        <p className="form-nav-eyebrow">Compilazione</p>
        <p className="form-nav-title">{pct === 100 ? 'Tutto pronto ✓' : 'In compilazione'}</p>
        <div className="form-nav-progress-row">
          <div className="form-nav-progress-bar">
            <div className="form-nav-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="form-nav-pct">{pct}%</span>
        </div>
      </div>

      {links.map((link) => {
        const prog = progress[link.key];
        const done = prog.completed === prog.total;
        const partial = prog.completed > 0 && !done;
        const state = done ? 'done' : partial ? 'partial' : 'empty';
        const isActive = activeSection === link.id && (!link.role || link.role === activeRole);

        return (
          <button
            key={`${link.id}-${link.key}`}
            type="button"
            className={`form-nav-link${isActive ? ' is-active' : ''}`}
            onClick={() => onNavigate(link.id, link.role)}
          >
            <CheckCircle state={state} isActive={isActive} />
            <span className="form-nav-label">{link.label}</span>
            <span className="form-nav-meta">
              {prog.completed}/{prog.total}
            </span>
          </button>
        );
      })}

      <div className="form-nav-shortcuts">
        <p>Scorciatoia</p>
        <div className="shortcut-row"><kbd>Ctrl+S</kbd> → salva</div>
      </div>
    </nav>
  );
}
