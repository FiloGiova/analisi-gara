// Righe shimmer mostrate durante il caricamento delle liste,
// al posto dei testi "Caricamento…".
export default function ListSkeleton({ rows = 5 }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Caricamento in corso">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}
