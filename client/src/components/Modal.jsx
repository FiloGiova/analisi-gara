import { createPortal } from 'react-dom';

// Finestra modale condivisa per form di creazione/modifica.
// Per le sole conferme usare ConfirmModal.
export default function Modal({ title, children, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Chiudi</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
