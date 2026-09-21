import { createPortal } from 'react-dom';
import { useEffect, useId, useRef } from 'react';

// Finestra modale condivisa per form di creazione/modifica.
// Per le sole conferme usare ConfirmModal.
export default function Modal({ title, children, onClose }) {
  const titleId = useId();
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(box.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])].filter((element) => element.getClientRects().length);
    focusable()[0]?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); box.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box form-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box} onClick={(event) => event.stopPropagation()}>
        <div className="section-heading modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
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
