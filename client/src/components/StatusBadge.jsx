export default function StatusBadge({ status }) {
  const isFinal = status === 'final';
  return (
    <span className={`status-badge ${isFinal ? 'status-final' : 'status-draft'}`}>
      {isFinal ? 'Definitivo' : 'Bozza'}
    </span>
  );
}
