import { useEffect, useMemo, useRef, useState } from 'react';
import DateInput from './DateInput.jsx';
import {
  addDays,
  currentMonth,
  currentWeekend,
  formatPeriodLabel,
  isValidIsoDate,
  todayIso
} from '../../../shared/gamePeriod.js';

// Filtro "Periodo" delle gare: stesso trigger delle altre tendine della
// FilterBar, con i preset che coprono i casi veri (oggi, weekend, prossimi
// giorni) e un calendario disegnato con i token dell'app — mai il date picker
// nativo, che ogni sistema operativo rende a modo suo.

const WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

function monthKeyOf(iso) {
  return iso ? iso.slice(0, 7) : todayIso().slice(0, 7);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// Griglia 6×7 che parte dal lunedì, con i giorni di spillo dei mesi adiacenti.
function monthGrid(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (first.getUTCDay() + 6) % 7; // lunedì = 0
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - shift);
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const iso = day.toISOString().slice(0, 10);
    days.push({ iso, day: day.getUTCDate(), inMonth: iso.slice(0, 7) === monthKey });
  }
  return days;
}

function presetsFor(today) {
  const weekend = currentWeekend(today);
  const month = currentMonth(today);
  return [
    { id: 'today', label: 'Oggi', from: today, to: today },
    { id: 'weekend', label: 'Questo weekend', from: weekend.from, to: weekend.to },
    { id: 'next7', label: 'Prossimi 7 giorni', from: today, to: addDays(today, 7) },
    { id: 'fromToday', label: 'Da oggi in poi', from: today, to: '' },
    { id: 'month', label: 'Questo mese', from: month.from, to: month.to },
    { id: 'all', label: 'Tutta la stagione', from: '', to: '' }
  ];
}

export default function PeriodFilter({
  from = '',
  to = '',
  onChange,
  // Giorni con almeno una gara: il pallino sotto il numero rende visibili i
  // weekend di campionato senza dover aprire nulla.
  daysWithGames = [],
  inline = false,
  triggerLabel = 'Periodo'
}) {
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(from || to || today));
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);
  const wrapRef = useRef(null);
  const gameDays = useMemo(() => new Set(daysWithGames), [daysWithGames.join('|')]);
  const presets = useMemo(() => presetsFor(today), [today]);

  useEffect(() => {
    setPendingFrom(from);
    setPendingTo(to);
    if (from || to) setMonthKey(monthKeyOf(from || to));
  }, [from, to]);

  useEffect(() => {
    if (!open || inline) return undefined;
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
  }, [open, inline]);

  const hasPeriod = Boolean(from || to);
  const label = hasPeriod ? formatPeriodLabel(from, to, { today }) : triggerLabel;

  function apply(nextFrom, nextTo, { close = true } = {}) {
    onChange({ from: nextFrom || '', to: nextTo || '' });
    if (close) setOpen(false);
  }

  // Click sul calendario: il primo fissa l'inizio, il secondo la fine.
  // Cliccare prima dell'inizio ricomincia da capo, senza intervalli al contrario.
  function handleDayClick(iso) {
    if (!pendingFrom || (pendingFrom && pendingTo)) {
      setPendingFrom(iso);
      setPendingTo('');
      return;
    }
    if (iso < pendingFrom) {
      setPendingFrom(iso);
      setPendingTo('');
      return;
    }
    setPendingTo(iso);
    apply(pendingFrom, iso);
  }

  function shiftMonth(delta) {
    const [year, month] = monthKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    setMonthKey(`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`);
  }

  const days = monthGrid(monthKey);
  const [monthYear, monthNumber] = monthKey.split('-').map(Number);
  const rangeStart = pendingFrom;
  const rangeEnd = pendingTo || pendingFrom;

  const panel = (
    <div className="period-panel">
      <div className="period-presets">
        {presets.map((preset) => {
          const active = (preset.from || '') === from && (preset.to || '') === to;
          return (
            <button
              key={preset.id}
              type="button"
              className={`period-preset${active ? ' is-active' : ''}`}
              onClick={() => apply(preset.from, preset.to)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="period-calendar">
        <div className="period-calendar-head">
          <button type="button" className="period-nav" onClick={() => shiftMonth(-1)} aria-label="Mese precedente">‹</button>
          <span>{MONTHS[monthNumber - 1]} {monthYear}</span>
          <button type="button" className="period-nav" onClick={() => shiftMonth(1)} aria-label="Mese successivo">›</button>
        </div>

        <div className="period-weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}
        </div>

        <div className="period-grid" role="grid">
          {days.map((day) => {
            const inRange = rangeStart && rangeEnd && day.iso >= rangeStart && day.iso <= rangeEnd;
            const isStart = day.iso === rangeStart;
            const isEnd = day.iso === rangeEnd;
            const classes = [
              'period-day',
              day.inMonth ? '' : 'is-outside',
              inRange ? 'is-in-range' : '',
              isStart ? 'is-start' : '',
              isEnd ? 'is-end' : '',
              day.iso === today ? 'is-today' : ''
            ].filter(Boolean).join(' ');
            return (
              <button
                key={day.iso}
                type="button"
                className={classes}
                onClick={() => handleDayClick(day.iso)}
                aria-pressed={Boolean(inRange)}
              >
                {day.day}
                {gameDays.has(day.iso) ? <span className="period-dot" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <div className="period-manual">
          <label>
            <span>Dal</span>
            <DateInput
              value={pendingFrom}
              onChange={(value) => {
                setPendingFrom(value);
                if (isValidIsoDate(value)) {
                  setMonthKey(monthKeyOf(value));
                  apply(value, pendingTo, { close: false });
                }
              }}
            />
          </label>
          <label>
            <span>Al</span>
            <DateInput
              value={pendingTo}
              onChange={(value) => {
                setPendingTo(value);
                if (isValidIsoDate(value)) apply(pendingFrom, value, { close: false });
              }}
            />
          </label>
        </div>

        <div className="period-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => { setPendingFrom(''); setPendingTo(''); apply('', ''); }}
          >
            Azzera
          </button>
          {!inline ? (
            <button type="button" className="primary-button" onClick={() => setOpen(false)}>Chiudi</button>
          ) : null}
        </div>
      </div>
    </div>
  );

  // Dentro il bottom sheet dei filtri il pannello si espande in linea: un
  // popover dentro un foglio modale si comporta male su mobile.
  if (inline) {
    return (
      <div className="period-filter is-inline">
        <p className="period-inline-title">{triggerLabel}: <strong>{label}</strong></p>
        {panel}
      </div>
    );
  }

  return (
    <div className={`custom-select period-filter ${open ? 'is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`custom-select-value ${hasPeriod ? '' : 'is-placeholder'}`}>
          {hasPeriod ? `${triggerLabel}: ${label}` : triggerLabel}
        </span>
        <span className="custom-select-caret" aria-hidden="true">▾</span>
      </button>
      {open ? panel : null}
    </div>
  );
}
