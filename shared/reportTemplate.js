// I campionati non vivono più qui: sono nella tabella `competitions`, gestita
// dall'admin (client: useCompetitions() in client/src/lib/competitions.jsx;
// server: src/services/competitionService.js; seed in src/database/connection.js).

export function deriveSeason(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

export function currentSportSeason(date = new Date()) {
  return deriveSeason(date instanceof Date ? date.toISOString().slice(0, 10) : date);
}

export const COMMON_REQUIRED_FIELDS = [
  ['observerName', 'Osservatore'],
  ['reportDate', 'Data'],
  ['matchNumber', 'Numero gara'],
  ['competition', 'Campionato'],
  ['teamHome', 'Squadra casa'],
  ['teamAway', 'Squadra ospite'],
  ['scoreHome', 'Punti casa'],
  ['scoreAway', 'Punti ospite'],
  ['firstRefereeName', '1° arbitro'],
  ['secondRefereeName', '2° arbitro']
];

// ── Versioni della struttura del rapporto ───────────────────────────────────
// v1: modello in uso fino alla stagione 2025/2026 (scala a 3, 8 sezioni).
// v2: modello federale 2026/2027 (scala a 5, 5 sezioni, fascia e voto decimale).
// I rapporti archiviati restano leggibili ed esportabili con la struttura con
// cui sono stati scritti: `templateVersion` viaggia dentro payload_json e tutto
// ciò che disegna un rapporto (form, PDF, grafici) sceglie il template da lì.
export const REPORT_TEMPLATE_VERSION = 2;

export const RATING_OPTIONS_V1 = {
  difficulty: ['Normale', 'Impegnativa', 'Difficile'],
  fitness: ['Migliorabile', 'Standard', 'Eccellente'],
  quality: ['Migliorabile', 'Standard', 'Di qualità'],
  qualityWithNotEvaluable: ['Migliorabile', 'Standard', 'Di qualità', 'N/V']
};

export const COMMON_MATCH_CHARACTERISTICS_V1 = {
  id: 'matchCharacteristics',
  title: '1) Caratteristiche della gara',
  description: 'Difficoltà ambientale / complessità tecnica',
  groups: [
    { id: 'difficulty', label: 'Difficoltà gara', options: RATING_OPTIONS_V1.difficulty, defaultValue: 'Normale' }
  ],
  commentLabel: 'Commento sulla gara',
  requiredCommentForFinal: true
};

export const EVALUATION_SECTIONS_V1 = [
  {
    id: 'fitness',
    title: '2) Stato di forma / atletismo',
    description: 'Continuità, reattività, velocità nelle transizioni',
    groups: [
      { id: 'level', label: 'Valutazione atletica', options: RATING_OPTIONS_V1.fitness }
    ],
    commentLabel: 'Commento su stato di forma e atletismo',
    requiredCommentForFinal: true
  },
  {
    id: 'management',
    title: '3) Conduzione',
    groups: [
      {
        id: 'leadership',
        label: '3.1 Leadership / assunzione di responsabilità / gestione momenti topici',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'teamwork',
        label: '3.2 Lavoro di squadra / iniziative / collaborazione / atteggiamento',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'consistency',
        label: '3.3 Metro di valutazione / credibilità / tempestività decisioni',
        options: RATING_OPTIONS_V1.quality
      }
    ],
    commentLabel: 'Commento sulla conduzione',
    requiredCommentForFinal: true
  },
  {
    id: 'discipline',
    title: "4) Disciplina e rapporti con l'ambiente",
    groups: [
      {
        id: 'conflictManagement',
        label: '4.1 Anticipazione problemi / gestione conflitti / autorevolezza',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'measures',
        label: '4.2 Corretto uso ed efficacia dei provvedimenti',
        options: RATING_OPTIONS_V1.qualityWithNotEvaluable
      }
    ],
    commentLabel: "Commento su disciplina e rapporti con l'ambiente",
    requiredCommentForFinal: true
  },
  {
    id: 'technique',
    title: '5) Tecnica',
    groups: [
      {
        id: 'travel',
        category: '5.1 Violazioni',
        label: '5.1.1 Passi (lettura di arresto, partenza, piede perno)',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'timingRules',
        category: '5.1 Violazioni',
        label: '5.1.2 Regole a tempo (3", 5", 8", 24")',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'otherViolations',
        category: '5.1 Violazioni',
        label: '5.1.3 Altre violazioni (interferenze, RPZD, rimesse, ecc.)',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'shootingFouls',
        category: '5.2 Falli - gioco con palla',
        label: '5.2.1 Atto di tiro (falli sul e del tiratore, movimento continuo)',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'contactResponsibility',
        category: '5.2 Falli - gioco con palla',
        label: '5.2.2 Responsabilità contatti (attacco/difesa, uso illegale mani, ecc.)',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'rebound',
        category: '5.3 Falli - gioco senza palla',
        label: '5.3.1 Rimbalzo / prese di posizione / ecc.',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'screensCuts',
        category: '5.3 Falli - gioco senza palla',
        label: '5.3.2 Blocchi / tagli',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'unsportsmanlike',
        category: '5.4 Fallo antisportivo / fallo squalificante',
        label: '5.4 Fallo antisportivo / fallo squalificante',
        options: RATING_OPTIONS_V1.qualityWithNotEvaluable
      },
      {
        id: 'simulations',
        category: '5.5 Simulazioni e altre situazioni regolamentari',
        label: '5.5 Simulazioni ed altre situazioni regolamentari',
        options: RATING_OPTIONS_V1.qualityWithNotEvaluable
      }
    ],
    commentLabel: 'Commento sulla tecnica',
    requiredCommentForFinal: true
  },
  {
    id: 'administration',
    title: '6) Amministrazione del gioco',
    description: 'Controllo cronometri, salto a due, punti di rimessa, freccia PA, sospensioni, sostituzioni',
    groups: [
      { id: 'level', label: 'Valutazione amministrazione', options: RATING_OPTIONS_V1.quality }
    ]
  },
  {
    id: 'communication',
    title: '7) Comunicazione',
    description: 'Modalità segnalazioni, supporto vocale, segnali FIBA, linguaggio del corpo, collaborazione con UDC',
    groups: [
      { id: 'level', label: 'Valutazione comunicazione', options: RATING_OPTIONS_V1.quality }
    ]
  },
  {
    id: 'mechanics',
    title: '8) Meccanica',
    groups: [
      {
        id: 'gameReading',
        label: '8.1 Lettura del gioco / adeguamenti / rotazioni / attraversamenti',
        options: RATING_OPTIONS_V1.quality
      },
      {
        id: 'responsibilities',
        label: '8.2 Rispetto competenze / aiuti',
        options: RATING_OPTIONS_V1.quality
      }
    ],
    commentLabel: 'Commento su comunicazione e meccanica',
    requiredCommentForFinal: true
  }
];

// ── Struttura corrente (v2, linee guida 2026/2027) ──────────────────────────

// Scala a cinque livelli: gli estremi sono i giudizi "parlanti", i due livelli
// intermedi sfumano verso lo standard. Stesso ordine ovunque (form, PDF,
// grafici), perché l'ordine è la scala.
export const RATING_SCALE = [
  'Migliorabile',
  'Sotto lo standard',
  'Standard',
  'Sopra lo standard',
  'Di qualità'
];

export const NOT_EVALUABLE = 'N.V.';

export const RATING_OPTIONS = {
  difficulty: ['Facile', 'Di normale difficoltà', 'Impegnativa', 'Difficile'],
  fitness: ['Migliorabile', 'Standard', 'Eccellente'],
  quality: RATING_SCALE,
  qualityWithNotEvaluable: [...RATING_SCALE, NOT_EVALUABLE]
};

// Mappa rating qualitativi → numerici per i grafici di andamento, su una scala
// unica 0-4 che tiene insieme le due versioni: i tre livelli della v1 cadono
// sui gradini 0, 2 e 4 della v2, così le curve restano confrontabili.
export const RATING_SCALE_MAX = 4;

export const RATING_VALUE_MAP = {
  'Migliorabile': 0,
  'Sotto lo standard': 1,
  'Standard': 2,
  'Sopra lo standard': 3,
  'Di qualità': 4,
  'Eccellente': 4
};

export function ratingToNumber(rating) {
  if (!rating || rating === 'N/V' || rating === NOT_EVALUABLE) return null;
  return RATING_VALUE_MAP[rating] ?? null;
}

// ── Fascia e voto ───────────────────────────────────────────────────────────
// La griglia federale lega ogni voto a una sola fascia: il voto è il dato
// portante, la fascia si deriva (bandForVote). I voti sono TESTO con il punto
// decimale ("8.0"), così restano ordinabili e sommabili anche in SQL; il punto
// diventa virgola solo quando il numero viene mostrato (formatVote).
export const VOTE_BANDS = [
  { id: 'migliorabile', label: 'Migliorabile', votes: ['7.2', '7.3', '7.4'] },
  { id: 'sotto', label: 'Sotto lo standard', votes: ['7.5', '7.6', '7.7'] },
  { id: 'standard', label: 'Standard', votes: ['7.8', '7.9', '8.0', '8.1', '8.2'] },
  { id: 'sopra', label: 'Sopra lo standard', votes: ['8.3', '8.4', '8.5'] },
  { id: 'qualita', label: 'Di qualità', votes: ['8.6', '8.7', '8.8'] }
];

export const VOTE_BAND_LABELS = VOTE_BANDS.map((band) => band.label);
export const VOTE_VALUES = VOTE_BANDS.flatMap((band) => band.votes);

export function normalizeVoteValue(value) {
  if (value === null || value === undefined) return '';
  const clean = String(value).trim().replace(',', '.');
  if (!clean) return '';
  const number = Number(clean);
  if (!Number.isFinite(number)) return '';
  const candidate = number.toFixed(1);
  return VOTE_VALUES.includes(candidate) ? candidate : '';
}

export function bandForVote(vote) {
  const clean = normalizeVoteValue(vote);
  if (!clean) return '';
  const band = VOTE_BANDS.find((entry) => entry.votes.includes(clean));
  return band ? band.label : '';
}

export function bandByLabel(label) {
  return VOTE_BANDS.find((band) => band.label === label) || null;
}

// Il voto si mostra all'italiana: 8.0 → "8,0". I decimali restano quelli che
// ci sono: i voti interi delle stagioni precedenti non diventano "68,0".
export function formatVote(vote) {
  const clean = String(vote ?? '').trim();
  if (!clean) return '';
  const normalized = clean.replace(',', '.');
  if (!Number.isFinite(Number(normalized))) return clean;
  return normalized.replace('.', ',');
}

export const POTENTIAL_OPTIONS = ['Nessuna', 'Bassa', 'Media', 'Alta'];

export const COMMON_MATCH_CHARACTERISTICS = {
  id: 'matchCharacteristics',
  title: '1) Caratteristiche della gara',
  description: 'Difficoltà ambientale / complessità tecnica',
  groups: [
    {
      id: 'difficulty',
      label: 'Difficoltà della gara',
      options: RATING_OPTIONS.difficulty,
      defaultValue: 'Di normale difficoltà'
    }
  ],
  commentLabel: 'Note',
  requiredCommentForFinal: true
};

export const EVALUATION_SECTIONS = [
  {
    id: 'fitness',
    title: "2) Stato di forma / atleticità / immagine",
    description: 'Aspetto atletico, continuità, reattività, velocità nelle transizioni',
    groups: [
      { id: 'level', label: 'Valutazione atletica', options: RATING_OPTIONS.fitness }
    ],
    commentLabel: 'Note',
    requiredCommentForFinal: true
  },
  {
    id: 'conduct',
    title: '3) Conduzione e aspetti disciplinari',
    groups: [
      {
        id: 'evaluationCriteria',
        label: '3.1 Metro di valutazione / lavoro di squadra / tempestività decisioni / assunzione di responsabilità',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'conflictManagement',
        label: '3.2 Anticipazione problemi / gestione conflitti / applicazione delle sanzioni',
        options: RATING_OPTIONS.quality
      }
    ],
    commentLabel: 'Note',
    requiredCommentForFinal: true
  },
  {
    id: 'technique',
    title: '4) Tecnica',
    groups: [
      {
        id: 'travel',
        category: '4.0 Violazioni',
        label: '4.0.1 Passi (lettura di arresto, piede perno, partenza)',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'otherViolations',
        category: '4.0 Violazioni',
        label: '4.0.2 Altre violazioni (interferenze, regole a tempo, rimesse, tiri liberi, protocolli, falli tecnici amministrativi di cat. 2)',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'shootingFouls',
        category: '4.1 Falli - gioco con palla',
        label: '4.1.1 Atto di tiro - movimento continuo',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'contactResponsibility',
        category: '4.1 Falli - gioco con palla',
        label: '4.1.2 Responsabilità contatti (uso illegale delle mani, bloccaggio-sfondamento, simulazioni, protocolli)',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'rebound',
        category: '4.2 Falli - gioco senza palla',
        label: '4.2.1 Rimbalzo / prese di posizione / tagli / uso illegale delle mani',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'screensCuts',
        category: '4.2 Falli - gioco senza palla',
        label: '4.2.2 Blocchi / bloccaggio-sfondamento / uso illegale delle mani / responsabilità dei contatti',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'flagrantFouls',
        category: '4.3 - 4.4 Situazioni particolari',
        label: '4.3 Falli flagranti / tattici / squalificanti',
        options: RATING_OPTIONS.qualityWithNotEvaluable
      },
      {
        id: 'otherSituations',
        category: '4.3 - 4.4 Situazioni particolari',
        label: '4.4 Altre situazioni regolamentari non rientranti nei punti precedenti (es. protocollo IRS)',
        options: RATING_OPTIONS.qualityWithNotEvaluable
      }
    ],
    commentLabel: 'Note',
    requiredCommentForFinal: true
  },
  {
    id: 'mechanics',
    title: '5) Meccanica / tecnica arbitrale individuale / comunicazione',
    groups: [
      {
        id: 'gameReading',
        label: '5.0 Lettura del gioco / adeguamenti / rotazioni (attraversamenti) / rispetto competenze / aiuti / timing del fischio',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'clockControl',
        label: '5.1 Controllo cronometri / tempi morti / segnalazioni (supporto vocale) / applicazione protocolli / comunicazione verbale e non',
        options: RATING_OPTIONS.quality
      }
    ],
    commentLabel: 'Note',
    requiredCommentForFinal: true
  }
];

// Blocchi di testo che chiudono la scheda di ogni arbitro (v2). Sostituiscono
// il "giudizio globale" unico della v1.
export const CLOSING_FIELDS = [
  {
    id: 'strengths',
    label: 'Punti di forza da mantenere',
    placeholder: 'Cosa ha funzionato e va consolidato...',
    requiredForFinal: true
  },
  {
    id: 'improvements',
    label: 'Aree di miglioramento',
    placeholder: 'Su cosa lavorare nelle prossime gare...',
    requiredForFinal: true
  },
  {
    id: 'additionalNotes',
    label: 'Eventuali note aggiuntive',
    placeholder: 'Altro che merita di restare nel rapporto...'
  },
  {
    id: 'technicalErrors',
    label: 'Eventuali errori tecnici',
    placeholder: 'Indicare tipo di errore e riferimento al tempo di gioco. Se assenti: NO'
  }
];

// ── Selezione del template in base al rapporto ──────────────────────────────

export function templateVersionOf(payload) {
  const declared = Number(payload?.templateVersion);
  if (declared === 1 || declared === 2) return declared;
  // Rapporti scritti prima dell'introduzione del campo: li riconosciamo dalle
  // sezioni che solo la v1 aveva.
  const evaluations = payload?.evaluations || {};
  const legacy = ['first', 'second'].some((role) => {
    const sections = evaluations[role]?.sections;
    if (!sections) return false;
    return Boolean(sections.administration || sections.communication || sections.management || sections.discipline);
  });
  return legacy ? 1 : REPORT_TEMPLATE_VERSION;
}

export function sectionsForVersion(version) {
  return version === 1 ? EVALUATION_SECTIONS_V1 : EVALUATION_SECTIONS;
}

export function matchCharacteristicsForVersion(version) {
  return version === 1 ? COMMON_MATCH_CHARACTERISTICS_V1 : COMMON_MATCH_CHARACTERISTICS;
}

export function sectionsForPayload(payload) {
  return sectionsForVersion(templateVersionOf(payload));
}

export function matchCharacteristicsForPayload(payload) {
  return matchCharacteristicsForVersion(templateVersionOf(payload));
}

export function createEmptySection(section) {
  return {
    ratings: Object.fromEntries(
      section.groups.map((group) => [group.id, group.defaultValue || (group.options.includes('Standard') ? 'Standard' : '')])
    ),
    comment: section.commentLabel ? '' : undefined
  };
}

export function createEmptyEvaluation(version = REPORT_TEMPLATE_VERSION) {
  const sections = Object.fromEntries(
    sectionsForVersion(version).map((section) => [section.id, createEmptySection(section)])
  );
  const potential = { level: '', comment: '' };

  if (version === 1) {
    return { sections, globalJudgement: '', technicalErrors: 'NO', vote: '', potential };
  }

  return {
    sections,
    strengths: '',
    improvements: '',
    additionalNotes: '',
    technicalErrors: 'NO',
    band: '',
    vote: '',
    potential
  };
}

export function createEmptyReport(version = REPORT_TEMPLATE_VERSION) {
  return {
    templateVersion: version,
    status: 'draft',
    observerName: '',
    reportDate: new Date().toISOString().slice(0, 10),
    matchNumber: '',
    competition: '',
    teamHome: '',
    teamAway: '',
    scoreHome: '',
    scoreAway: '',
    firstRefereeId: null,
    firstRefereeName: '',
    secondRefereeId: null,
    secondRefereeName: '',
    matchCharacteristics: createEmptySection(matchCharacteristicsForVersion(version)),
    evaluations: {
      first: createEmptyEvaluation(version),
      second: createEmptyEvaluation(version)
    }
  };
}

// ── Rapporto a video ────────────────────────────────────────────────────────
// Visionatura fatta sul video della gara: niente sezioni di valutazione e
// niente voto numerico, solo un giudizio sintetico per arbitro più un
// allegato (il referto del formatore, in PDF o XLSX). Conta come visionatura
// esattamente come un rapporto completo: per questo vive nella stessa tabella
// `reports`, distinto solo da `reportType`.
export const REPORT_TYPES = ['full', 'video'];

export function normalizeReportType(value) {
  return value === 'video' ? 'video' : 'full';
}

export const VIDEO_JUDGMENT_OPTIONS = ['Molto bene', 'Bene', 'Malino', 'Male'];

// Campi identificativi obbligatori per rendere definitivo un rapporto a video.
// Rispetto al rapporto completo mancano i punteggi: su una visionatura video
// il risultato non è un dato che il formatore deve ricopiare.
export const VIDEO_REQUIRED_FIELDS = [
  ['observerName', 'Osservatore'],
  ['reportDate', 'Data'],
  ['matchNumber', 'Numero gara'],
  ['competition', 'Campionato'],
  ['teamHome', 'Squadra casa'],
  ['teamAway', 'Squadra ospite'],
  ['firstRefereeName', '1° arbitro'],
  ['secondRefereeName', '2° arbitro']
];

export function createEmptyVideoReport() {
  return {
    reportType: 'video',
    status: 'draft',
    observerName: '',
    reportDate: new Date().toISOString().slice(0, 10),
    matchNumber: '',
    competition: '',
    teamHome: '',
    teamAway: '',
    firstRefereeId: null,
    firstRefereeName: '',
    secondRefereeId: null,
    secondRefereeName: '',
    judgements: { first: '', second: '' },
    feedback: { first: '', second: '' },
    notes: ''
  };
}

export function getRefereeLabel(role) {
  return role === 'first' ? '1° arbitro' : '2° arbitro';
}

export function getRefereeNumber(role) {
  return role === 'first' ? '1' : '2';
}
