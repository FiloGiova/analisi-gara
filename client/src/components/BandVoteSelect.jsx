import { useEffect, useRef, useState } from 'react';
import { VOTE_BANDS, bandForVote, formatVote } from '../../../shared/reportTemplate.js';

// Fascia e voto sono un dato solo: la griglia federale lega ogni voto a una
// fascia, quindi si sceglie il voto dentro la fascia e la fascia si compila da
// sé. La fascia resta selezionabile da sola finché il voto non c'è.
export default function BandVoteSelect({ vote = '', band = '', onChange, disabled = false, id }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  const activeBand = (vote ? bandForVote(vote) : band) || '';

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pickVote(value) {
    onChange({ vote: value, band: bandForVote(value) });
    setOpen(false);
    triggerRef.current?.focus();
  }

  function pickBand(label) {
    // Il voto comanda sulla fascia: se appartiene a un'altra fascia, scegliere
    // la fascia a mano lo azzera.
    const definition = VOTE_BANDS.find((entry) => entry.label === label);
    const keepsVote = Boolean(vote) && Boolean(definition?.votes.includes(vote));
    onChange({ vote: keepsVote ? vote : '', band: label });
  }

  return (
    <div
      className={`custom-select band-vote ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
      ref={wrapRef}
    >
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="custom-select-trigger band-vote-trigger"
        data-band={activeBand || undefined}
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="band-vote-dot" data-band={activeBand || undefined} aria-hidden="true" />
        <span className={`custom-select-value ${activeBand ? '' : 'is-placeholder'}`}>
          {activeBand || 'Fascia e voto'}
        </span>
        {vote ? <strong className="band-vote-number">{formatVote(vote)}</strong> : null}
        <span className="custom-select-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="band-vote-menu" role="dialog" aria-label="Fascia e voto">
          <p className="band-vote-hint">Scegli il voto nella fascia</p>
          {VOTE_BANDS.map((entry) => (
            <div
              key={entry.id}
              className={`band-vote-row ${activeBand === entry.label ? 'is-active' : ''}`}
              data-band={entry.label}
            >
              <button
                type="button"
                className="band-vote-chip"
                data-band={entry.label}
                aria-pressed={activeBand === entry.label}
                onClick={() => pickBand(entry.label)}
              >
                {entry.label}
              </button>
              <div className="band-vote-cards">
                {entry.votes.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="band-vote-card"
                    data-band={entry.label}
                    aria-pressed={vote === value}
                    onClick={() => pickVote(value)}
                  >
                    {formatVote(value)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="band-vote-foot">
            <span>Fascia comunicata nel colloquio, voto visibile all'arbitro nel rapporto.</span>
            {vote || band ? (
              <button type="button" className="link-button" onClick={() => { onChange({ vote: '', band: '' }); setOpen(false); }}>
                Azzera
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
