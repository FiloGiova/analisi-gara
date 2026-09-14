import { useEffect, useRef, useState } from 'react';

// Menu compatto per scegliere le colonne visibili di una tabella.
// Sta in fondo alla FilterBar e riusa gli stili .custom-select* dei selettori.
// Le colonne obbligatorie non compaiono in elenco: non sono nascondibili.
export default function ColumnsMenu({ columns, visible, onChange, label = 'Colonne' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const optional = columns.filter((column) => !column.required);
  const hiddenCount = optional.filter((column) => !visible.includes(column.key)).length;

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(key) {
    onChange(visible.includes(key) ? visible.filter((item) => item !== key) : [...visible, key]);
  }

  return (
    <div className={`custom-select columns-menu ${open ? 'is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="columns-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={hiddenCount ? `${label}: ${hiddenCount} nascoste` : label}
        title={label}
      >
        <span className="columns-menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {hiddenCount ? <span className="columns-menu-count">{hiddenCount}</span> : null}
      </button>
      {open ? (
        <ul className="custom-select-menu columns-menu-list" role="listbox" aria-multiselectable="true">
          <li className="columns-menu-title">Colonne visibili</li>
          {optional.map((column) => (
            <li
              key={column.key}
              role="option"
              aria-selected={visible.includes(column.key)}
              className={`custom-select-option multi-select-option ${visible.includes(column.key) ? 'is-selected' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                toggle(column.key);
              }}
            >
              <input type="checkbox" readOnly checked={visible.includes(column.key)} tabIndex={-1} />
              <span>{column.label}</span>
            </li>
          ))}
          {hiddenCount ? (
            <li className="multi-select-clear">
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(optional.map((column) => column.key));
                }}
              >
                Mostra tutte
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
