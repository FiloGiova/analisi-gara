import Modal from './Modal.jsx';
import { navigate } from '../lib/navigation.js';

// Bivio alla creazione: i due rapporti hanno schermate molto diverse, quindi il
// tipo si sceglie prima di aprire il form e poi non cambia più.
export default function NewReportChoice({ gameId = null, onClose }) {
  const suffix = gameId ? `?game=${gameId}` : '';
  const videoSuffix = gameId ? `?game=${gameId}&type=video` : '?type=video';

  return (
    <Modal title="Che rapporto vuoi compilare?" onClose={onClose}>
      <div className="report-type-choice">
        <button type="button" className="report-type-option" onClick={() => navigate(`/reports/new${suffix}`)}>
          <strong>Rapporto completo</strong>
          <span>Osservazione dal vivo: tutte le sezioni di valutazione, voto e PDF per i due arbitri.</span>
        </button>
        <button type="button" className="report-type-option" onClick={() => navigate(`/reports/new${videoSuffix}`)}>
          <strong>Rapporto a video</strong>
          <span>Visionatura da video: un giudizio sintetico per arbitro più il referto allegato. Conta come visionatura, senza voto.</span>
        </button>
      </div>
    </Modal>
  );
}
