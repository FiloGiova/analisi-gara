import { useEffect, useRef, useState } from 'react';

export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Seleziona...',
  disabled = false,
  searchable = false,
  id
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value);

  const filteredOptions = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) {
      setSearch('');
      return;
    }
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        if (searchable) inputRef.current?.blur();
        else triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const idx = filteredOptions.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : (filteredOptions.length > 0 ? 0 : -1));
  }, [open]);

  useEffect(() => {
    if (open && search) {
      setHighlight(filteredOptions.length > 0 ? 0 : -1);
    }
  }, [search]);

  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return;
    const li = listRef.current.querySelector(`li[data-idx="${highlight}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function pick(idx) {
    const opt = filteredOptions[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    setSearch('');
    if (searchable) inputRef.current?.blur();
    else triggerRef.current?.focus();
  }

  function handleNavKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlight((h) => Math.min(filteredOptions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight >= 0) pick(highlight);
      else setOpen(true);
    }
  }

  function handleTriggerKey(e) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  const renderOptions = () => (
    <ul
      ref={listRef}
      className="custom-select-menu"
      role="listbox"
      tabIndex={-1}
      onKeyDown={!searchable ? handleNavKey : undefined}
    >
      {filteredOptions.length === 0 ? (
        <li className="custom-select-empty">
          {searchable && search ? 'Nessun risultato' : 'Nessuna opzione'}
        </li>
      ) : (
        filteredOptions.map((opt, idx) => (
          <li
            key={opt.value || `__${idx}`}
            data-idx={idx}
            role="option"
            aria-selected={opt.value === value}
            className={[
              'custom-select-option',
              opt.value === value ? 'is-selected' : '',
              idx === highlight ? 'is-highlight' : ''
            ].join(' ').trim()}
            onMouseEnter={() => setHighlight(idx)}
            onMouseDown={(e) => { e.preventDefault(); pick(idx); }}
          >
            {opt.label}
          </li>
        ))
      )}
    </ul>
  );

  if (searchable) {
    return (
      <div
        className={`custom-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
        ref={wrapRef}
      >
        <div className="custom-select-trigger custom-select-trigger-input">
          <input
            id={id}
            ref={inputRef}
            type="text"
            className="custom-select-search-input"
            value={open ? search : (selected?.label || '')}
            onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => { setOpen(true); setSearch(''); }}
            onKeyDown={handleNavKey}
            placeholder={selected ? selected.label : placeholder}
            disabled={disabled}
            autoComplete="off"
          />
          <button
            type="button"
            className="custom-select-caret"
            tabIndex={-1}
            aria-label={open ? 'Chiudi menu' : 'Apri menu'}
            onMouseDown={(e) => {
              e.preventDefault();
              if (open) {
                setOpen(false);
                inputRef.current?.blur();
              } else {
                setOpen(true);
                setSearch('');
                inputRef.current?.focus();
              }
            }}
          >
            ▾
          </button>
        </div>
        {open ? renderOptions() : null}
      </div>
    );
  }

  return (
    <div
      className={`custom-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
      ref={wrapRef}
    >
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleTriggerKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`custom-select-value ${selected ? '' : 'is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="custom-select-caret" aria-hidden="true">▾</span>
      </button>
      {open ? renderOptions() : null}
    </div>
  );
}
