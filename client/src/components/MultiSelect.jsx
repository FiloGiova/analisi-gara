import { useEffect, useRef, useState } from 'react';

// Menu a tendina con checkbox: selezione multipla di valori.
// Riusa gli stili .custom-select* per restare coerente con Select.
export default function MultiSelect({
  values = [],
  onChange,
  options,
  placeholder = 'Seleziona…',
  allLabel,
  triggerLabel = '',
  triggerClassName = '',
  disabled = false,
  actionLabel = '',
  onAction,
  actionDisabled = false
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(value) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  const selectionLabel = values.length === 0
    ? (allLabel || placeholder)
    : values.length === 1
      ? (options.find((o) => o.value === values[0])?.label || '1 selezionata')
      : `${values.length} selezionate`;
  const label = triggerLabel
    ? `${triggerLabel}${values.length ? ` (${values.length})` : ''}`
    : selectionLabel;

  return (
    <div className={`custom-select multi-select ${open ? 'is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`custom-select-trigger ${triggerClassName}`.trim()}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`custom-select-value ${values.length ? '' : 'is-placeholder'}`}>{label}</span>
        <span className="custom-select-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="custom-select-menu" role="listbox" aria-multiselectable="true">
          {values.length ? (
            <li className="multi-select-clear">
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange([]); }}>
                Azzera selezione
              </button>
            </li>
          ) : null}
          {options.length === 0 ? (
            <li className="custom-select-empty">Nessuna opzione</li>
          ) : (
            options.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={values.includes(opt.value)}
                className={`custom-select-option multi-select-option ${values.includes(opt.value) ? 'is-selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); toggle(opt.value); }}
              >
                <input type="checkbox" readOnly checked={values.includes(opt.value)} tabIndex={-1} />
                <span>{opt.label}</span>
              </li>
            ))
          )}
          {onAction ? (
            <li className="multi-select-action">
              <button
                type="button"
                className="primary-button full-button"
                disabled={actionDisabled}
                onClick={() => {
                  if (actionDisabled) return;
                  onAction();
                  setOpen(false);
                }}
              >
                {actionLabel || 'Conferma selezione'}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
