import { createPortal } from 'react-dom';

// Finestra modale condivisa per form di creazione/modifica.
// Per le sole conferme usare ConfirmModal.
export default function Modal({ title, children, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading modal-heading">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Chiudi</button>
        </div>
        {/* Il contenuto scorre qui dentro: il modale non esce mai dallo schermo
            e la riga delle azioni resta appoggiata in fondo. */}
        <div className="modal-scroll">{children}</div>
      </div>
    </div>,
    document.body
  );
}
