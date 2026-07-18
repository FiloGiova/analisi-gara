// Stato vuoto uniforme: titolo opzionale, testo e azione opzionale.
export default function EmptyState({ title, action, children }) {
  return (
    <div className="empty-state">
      {title ? <h3>{title}</h3> : null}
      {children ? <p>{children}</p> : null}
      {action || null}
    </div>
  );
}
