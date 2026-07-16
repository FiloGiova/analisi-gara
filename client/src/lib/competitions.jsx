import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

// Catalogo campionati caricato una volta dopo il login e condiviso da tutte
// le pagine (prima era una costante compilata in shared/reportTemplate.js).
const CompetitionsContext = createContext({ competitions: [], loaded: false, reload: () => Promise.resolve() });

export function CompetitionsProvider({ children }) {
  const [competitions, setCompetitions] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(
    () =>
      api.listCompetitions()
        .then((data) => setCompetitions(data.competitions || []))
        .catch(() => {})
        .finally(() => setLoaded(true)),
    []
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(() => ({ competitions, loaded, reload }), [competitions, loaded, reload]);
  return <CompetitionsContext.Provider value={value}>{children}</CompetitionsContext.Provider>;
}

export function useCompetitions() {
  const { competitions, loaded, reload } = useContext(CompetitionsContext);
  return useMemo(() => {
    const activeCompetitions = competitions.filter((competition) => competition.active);
    const competitionLabel = (value) =>
      competitions.find((competition) => competition.value === value)?.label || value || '';
    return { competitions, activeCompetitions, competitionLabel, loaded, reload };
  }, [competitions, loaded, reload]);
}
