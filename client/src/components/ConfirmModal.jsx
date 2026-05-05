import { createPortal } from 'react-dom';

export default function ConfirmModal({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Annulla',
  confirmClassName = 'danger-button',
  onConfirm,
  onCancel
}) {
  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p>{children}</p>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={confirmClassName} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
