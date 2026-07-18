const STATE_BADGES = {
  calendario: { label: 'Solo calendario', variant: 'status-neutral' },
  arbitri_mancanti: { label: 'Arbitri da designare', variant: 'status-info' },
  senza_osservatore: { label: 'Scoperta', variant: 'status-warning' },
  designazione_completa: { label: 'Designazione completa', variant: 'status-teal' },
  rapporto_bozza: { label: 'Rapporto in bozza', variant: 'status-draft' },
  rapporto_definitivo: { label: 'Rapporto definitivo', variant: 'status-final' },
  rinviata: { label: 'Rinviata', variant: 'status-postponed' },
  annullata: { label: 'Annullata', variant: 'status-cancelled' }
};

export const GAME_STATE_OPTIONS = Object.entries(STATE_BADGES).map(([value, s]) => ({ value, label: s.label }));

export default function GameStateBadge({ state }) {
  const badge = STATE_BADGES[state] || STATE_BADGES.calendario;
  return (
    <span className={`status-badge status-badge-sm ${badge.variant}`}>
      {badge.label}
    </span>
  );
}
