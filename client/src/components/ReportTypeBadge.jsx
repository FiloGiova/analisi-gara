// Marcatore del rapporto a video negli elenchi. Etichetta testuale e non una
// sigla accanto al nome: si legge senza legenda ed è filtrabile.
export default function ReportTypeBadge({ type, small = true }) {
  if (type !== 'video') return null;
  return (
    <span className={`status-badge ${small ? 'status-badge-sm ' : ''}status-info`} title="Rapporto a video">
      VIDEO
    </span>
  );
}
