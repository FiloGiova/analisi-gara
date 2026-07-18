import { useState } from 'react';
import { navigate } from '../lib/navigation.js';
import ObserverAvailabilityPanel from '../components/ObserverAvailabilityPanel.jsx';
import UserAvatar from '../components/UserAvatar.jsx';

export default function ObserverDetailPage({ id }) {
  const [observer, setObserver] = useState(null);

  return (
    <div className="page-stack">
      <section className="detail-hero observer-detail-hero">
        <div className="observer-detail-identity">
          <UserAvatar photoPath={observer?.photoPath} name={observer?.displayName || 'Osservatore'} size={72} ring />
          <div>
            <p className="eyebrow">Profilo osservatore</p>
            <h1>{observer?.displayName || 'Caricamento…'}</h1>
            <p>
              {observer
                ? `${observer.role === 'instructor' ? 'Formatore' : 'Osservatore'} · @${observer.username}`
                : 'Carico dati e storico indisponibilità.'}
            </p>
          </div>
        </div>
        <button type="button" className="back-link" onClick={() => navigate('/observers')}>
          <span aria-hidden="true">←</span> Torna agli osservatori
        </button>
      </section>

      <ObserverAvailabilityPanel observerId={id} onProfileLoaded={setObserver} />
    </div>
  );
}
