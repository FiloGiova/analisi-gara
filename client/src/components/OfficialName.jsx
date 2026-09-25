// Designazione caricata dal designatore su FIP Analytics ma non ancora
// trasmessa: si vede subito, però può ancora cambiare.
export function ProvisionalBadge({ official }) {
  if (official?.status !== 'provisional') return null;
  return (
    <span className="status-badge status-badge-sm status-warning" title="Designazione temporanea: il designatore può ancora cambiarla">
      Temporanea
    </span>
  );
}

// Nome dell'ufficiale di gara negli elenchi, con lo stato della designazione.
export default function OfficialName({ official }) {
  if (!official) return '—';
  const name = official.refereeName || official.userName || official.externalName || '—';
  if (official.status !== 'provisional') return name;
  return (
    <span className="official-name">
      {name}
      <ProvisionalBadge official={official} />
    </span>
  );
}
