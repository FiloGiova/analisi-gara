import { useEffect, useRef, useState } from 'react';

const MIN_YEAR = 1900;
const MAX_YEAR = 2050;

function isoToIt(iso) {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function displayToIso(display) {
  const digits = display.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const dd   = digits.slice(0, 2);
  const mm   = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const day   = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year  = parseInt(yyyy, 10);
  if (year < MIN_YEAR || year > MAX_YEAR) return '';
  if (month < 1 || month > 12) return '';
  if (day   < 1 || day   > 31) return '';
  const maxDay = new Date(year, month, 0).getDate();
  if (day > maxDay) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function formatDigits(digits) {
  let out = '';
  for (let i = 0; i < digits.length && i < 8; i++) {
    if (i === 2 || i === 4) out += '/';
    out += digits[i];
  }
  return out;
}

// Returns true only if the typed digits could still become a valid date.
// Used to reject impossible characters in real-time (e.g. day "32", month "13").
function isValidPartial(digits) {
  if (digits.length >= 1) {
    if (parseInt(digits[0], 10) > 3) return false;
  }
  if (digits.length >= 2) {
    const day = parseInt(digits.slice(0, 2), 10);
    if (day < 1 || day > 31) return false;
  }
  if (digits.length >= 3) {
    if (parseInt(digits[2], 10) > 1) return false;
  }
  if (digits.length >= 4) {
    const month = parseInt(digits.slice(2, 4), 10);
    if (month < 1 || month > 12) return false;
  }
  if (digits.length >= 5) {
    const y1 = parseInt(digits[4], 10);
    if (y1 < 1 || y1 > 2) return false;
  }
  if (digits.length >= 6) {
    const y2 = parseInt(digits.slice(4, 6), 10);
    if (y2 < 19 || y2 > 20) return false;
  }
  if (digits.length === 8) {
    if (!displayToIso(formatDigits(digits))) return false;
  }
  return true;
}

function validationMessageFor(display) {
  const digits = display.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length !== 8) return 'Inserisci una data completa con anno di 4 cifre.';
  if (!displayToIso(display)) return 'Inserisci una data valida con anno di 4 cifre.';
  return '';
}

export default function DateInput({ value, onChange, disabled, id, ...inputProps }) {
  const [display, setDisplay] = useState(() => isoToIt(value));
  const inputRef = useRef(null);

  useEffect(() => {
    const currentIso = displayToIso(display);
    if (value !== currentIso) {
      setDisplay(isoToIt(value));
    }
  }, [value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(validationMessageFor(display));
  }, [display]);

  function handleChange(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
    if (!isValidPartial(digits)) return;
    const formatted = formatDigits(digits);
    setDisplay(formatted);
    onChange(displayToIso(formatted));
  }

  function handleKeyDown(e) {
    if (e.key === 'Backspace') {
      const pos = e.target.selectionStart;
      if (pos > 0 && display[pos - 1] === '/') {
        e.preventDefault();
        const newDisplay = display.slice(0, pos - 1) + display.slice(pos);
        const digits = newDisplay.replace(/\D/g, '');
        const formatted = formatDigits(digits);
        setDisplay(formatted);
        onChange(displayToIso(formatted));
        requestAnimationFrame(() => {
          if (e.target) e.target.setSelectionRange(pos - 1, pos - 1);
        });
      }
    }
  }

  return (
    <input
      id={id}
      ref={inputRef}
      type="text"
      value={display}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder="gg/mm/aaaa"
      maxLength={10}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="off"
      {...inputProps}
    />
  );
}
