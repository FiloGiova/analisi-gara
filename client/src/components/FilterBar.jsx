import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Barra filtri unica per tutte le pagine elenco.
// Desktop: riga singola sotto l'intestazione (ricerca → filtri → reset).
// Mobile (≤640px): ricerca a tutta larghezza + bottone "Filtri" che apre un
// bottom sheet con gli stessi controlli, così le tendine non occupano lo schermo.
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (event) => setMobile(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function FilterBar({ search, activeCount = 0, onReset, children }) {
  const mobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') setSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!mobile) setSheetOpen(false);
  }, [mobile]);

  const searchInput = search ? (
    <input
      type="search"
      className="filter-search"
      value={search.value}
      onChange={(event) => search.onChange(event.target.value)}
      placeholder={search.placeholder || 'Cerca…'}
      aria-label={search.placeholder || 'Cerca'}
    />
  ) : null;

  const resetButton = activeCount > 0 && onReset ? (
    <button type="button" className="filter-reset-btn" onClick={onReset}>
      Reset filtri
    </button>
  ) : null;

  if (!mobile) {
    return (
      <div className="filter-bar" role="group" aria-label="Filtri elenco">
        {searchInput}
        {children}
        {resetButton}
      </div>
    );
  }

  return (
    <div className="filter-bar filter-bar-mobile" role="group" aria-label="Filtri elenco">
      {searchInput}
      <button
        type="button"
        className={`filter-chip${activeCount > 0 ? ' has-filters' : ''}`}
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
      >
        {activeCount > 0 ? <span className="filter-dot" aria-hidden="true" /> : null}
        Filtri{activeCount > 0 ? ` · ${activeCount}` : ''}
      </button>
      {sheetOpen
        ? createPortal(
            <div className="sheet-overlay" onClick={() => setSheetOpen(false)}>
              <div
                className="filter-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Filtri"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="filter-sheet-handle" aria-hidden="true" />
                <p className="filter-sheet-title">Filtri</p>
                <div className="filter-sheet-body">{children}</div>
                <div className="filter-sheet-actions">
                  {activeCount > 0 && onReset ? (
                    <button type="button" className="ghost-button" onClick={onReset}>
                      Reset filtri
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="primary-button full-button"
                    onClick={() => setSheetOpen(false)}
                  >
                    Mostra risultati
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
