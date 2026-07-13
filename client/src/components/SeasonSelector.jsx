import { useEffect, useRef, useState } from 'react';
import { currentSportSeason } from '../../../shared/reportTemplate.js';

function shortSeason(season) {
  const [start, end] = String(season || '').split('/');
  return start && end ? `${start}/${end.slice(-2)}` : season;
}

export default function SeasonSelector({ value, seasons, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const currentSeason = currentSportSeason();
  const isArchive = value !== currentSeason;

  useEffect(() => {
    if (!open) return;
    function handleClick(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function selectSeason(season) {
    onChange(season);
    setOpen(false);
  }

  return (
    <div className={`season-switcher ${open ? 'is-open' : ''} ${isArchive ? 'is-archive' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="season-switcher-trigger"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Cambia la stagione visualizzata"
      >
        <span className="season-switcher-copy">
          <small>{isArchive ? 'Archivio' : 'Stagione corrente'}</small>
          <strong>{shortSeason(value)}</strong>
        </span>
        <span className="season-switcher-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="season-switcher-menu" role="listbox" aria-label="Stagione visualizzata">
          {seasons.map((season) => {
            const current = season === currentSeason;
            const selected = season === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`season-switcher-option ${selected ? 'is-selected' : ''}`}
                key={season}
                onClick={() => selectSeason(season)}
              >
                <span>
                  <strong>{shortSeason(season)}</strong>
                  <small>{current ? 'Stagione corrente' : 'Archivio'}</small>
                </span>
                {selected ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
