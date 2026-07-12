const STATE_STYLES = {
  calendario: { label: 'Solo calendario', background: 'var(--paper-2)', color: 'var(--muted)' },
  arbitri_mancanti: { label: 'Arbitri da designare', background: 'var(--blue-soft)', color: 'var(--blue)' },
  senza_osservatore: { label: 'Scoperta', background: 'var(--orange-soft)', color: 'var(--orange)' },
  designazione_completa: { label: 'Designazione completa', background: 'var(--teal-soft)', color: 'var(--teal)' },
  rapporto_bozza: { label: 'Rapporto in bozza', background: 'var(--draft-soft)', color: 'var(--draft)' },
  rapporto_definitivo: { label: 'Rapporto definitivo', background: 'var(--final-soft)', color: 'var(--final)' },
  rinviata: { label: 'Rinviata', background: 'var(--draft-soft)', color: 'var(--danger)' },
  annullata: { label: 'Annullata', background: 'var(--paper-2)', color: 'var(--danger)' }
};

export const GAME_STATE_OPTIONS = Object.entries(STATE_STYLES).map(([value, s]) => ({ value, label: s.label }));

export default function GameStateBadge({ state }) {
  const style = STATE_STYLES[state] || STATE_STYLES.calendario;
  return (
    <span
      className="status-badge"
      style={{ background: style.background, color: style.color, padding: '3px 8px', fontSize: '0.72rem' }}
    >
      {style.label}
    </span>
  );
}
