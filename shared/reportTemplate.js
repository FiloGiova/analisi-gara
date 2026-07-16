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

export const RATING_OPTIONS = {
  difficulty: ['Normale', 'Impegnativa', 'Difficile'],
  fitness: ['Migliorabile', 'Standard', 'Eccellente'],
  quality: ['Migliorabile', 'Standard', 'Di qualità'],
  qualityWithNotEvaluable: ['Migliorabile', 'Standard', 'Di qualità', 'N/V']
};

// Mappa rating qualitativi → numerici per i grafici di andamento.
// 'N/V' e valore vuoto → null (skip nel grafico).
export const RATING_VALUE_MAP = {
  'Migliorabile': 0,
  'Standard': 1,
  'Di qualità': 2,
  'Eccellente': 2
};

export function ratingToNumber(rating) {
  if (!rating || rating === 'N/V') return null;
  return RATING_VALUE_MAP[rating] ?? null;
}

export const POTENTIAL_OPTIONS = ['Nessuna', 'Bassa', 'Media', 'Alta'];

export const COMMON_MATCH_CHARACTERISTICS = {
  id: 'matchCharacteristics',
  title: '1) Caratteristiche della gara',
  description: 'Difficoltà ambientale / complessità tecnica',
  groups: [
    { id: 'difficulty', label: 'Difficoltà gara', options: RATING_OPTIONS.difficulty, defaultValue: 'Normale' }
  ],
  commentLabel: 'Commento sulla gara',
  requiredCommentForFinal: true
};

export const EVALUATION_SECTIONS = [
  {
    id: 'fitness',
    title: '2) Stato di forma / atletismo',
    description: 'Continuità, reattività, velocità nelle transizioni',
    groups: [
      { id: 'level', label: 'Valutazione atletica', options: RATING_OPTIONS.fitness }
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
        options: RATING_OPTIONS.quality
      },
      {
        id: 'teamwork',
        label: '3.2 Lavoro di squadra / iniziative / collaborazione / atteggiamento',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'consistency',
        label: '3.3 Metro di valutazione / credibilità / tempestività decisioni',
        options: RATING_OPTIONS.quality
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
        options: RATING_OPTIONS.quality
      },
      {
        id: 'measures',
        label: '4.2 Corretto uso ed efficacia dei provvedimenti',
        options: RATING_OPTIONS.qualityWithNotEvaluable
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
        options: RATING_OPTIONS.quality
      },
      {
        id: 'timingRules',
        category: '5.1 Violazioni',
        label: '5.1.2 Regole a tempo (3", 5", 8", 24")',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'otherViolations',
        category: '5.1 Violazioni',
        label: '5.1.3 Altre violazioni (interferenze, RPZD, rimesse, ecc.)',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'shootingFouls',
        category: '5.2 Falli - gioco con palla',
        label: '5.2.1 Atto di tiro (falli sul e del tiratore, movimento continuo)',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'contactResponsibility',
        category: '5.2 Falli - gioco con palla',
        label: '5.2.2 Responsabilità contatti (attacco/difesa, uso illegale mani, ecc.)',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'rebound',
        category: '5.3 Falli - gioco senza palla',
        label: '5.3.1 Rimbalzo / prese di posizione / ecc.',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'screensCuts',
        category: '5.3 Falli - gioco senza palla',
        label: '5.3.2 Blocchi / tagli',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'unsportsmanlike',
        category: '5.4 Fallo antisportivo / fallo squalificante',
        label: '5.4 Fallo antisportivo / fallo squalificante',
        options: RATING_OPTIONS.qualityWithNotEvaluable
      },
      {
        id: 'simulations',
        category: '5.5 Simulazioni e altre situazioni regolamentari',
        label: '5.5 Simulazioni ed altre situazioni regolamentari',
        options: RATING_OPTIONS.qualityWithNotEvaluable
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
      { id: 'level', label: 'Valutazione amministrazione', options: RATING_OPTIONS.quality }
    ]
  },
  {
    id: 'communication',
    title: '7) Comunicazione',
    description: 'Modalità segnalazioni, supporto vocale, segnali FIBA, linguaggio del corpo, collaborazione con UDC',
    groups: [
      { id: 'level', label: 'Valutazione comunicazione', options: RATING_OPTIONS.quality }
    ]
  },
  {
    id: 'mechanics',
    title: '8) Meccanica',
    groups: [
      {
        id: 'gameReading',
        label: '8.1 Lettura del gioco / adeguamenti / rotazioni / attraversamenti',
        options: RATING_OPTIONS.quality
      },
      {
        id: 'responsibilities',
        label: '8.2 Rispetto competenze / aiuti',
        options: RATING_OPTIONS.quality
      }
    ],
    commentLabel: 'Commento su comunicazione e meccanica',
    requiredCommentForFinal: true
  }
];

export function createEmptySection(section) {
  return {
    ratings: Object.fromEntries(
      section.groups.map((group) => [group.id, group.defaultValue || (group.options.includes('Standard') ? 'Standard' : '')])
    ),
    comment: section.commentLabel ? '' : undefined
  };
}

export function createEmptyEvaluation() {
  return {
    sections: Object.fromEntries(EVALUATION_SECTIONS.map((section) => [section.id, createEmptySection(section)])),
    globalJudgement: '',
    technicalErrors: 'NO',
    vote: '',
    potential: {
      level: '',
      comment: ''
    }
  };
}

export function createEmptyReport() {
  return {
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
    matchCharacteristics: createEmptySection(COMMON_MATCH_CHARACTERISTICS),
    evaluations: {
      first: createEmptyEvaluation(),
      second: createEmptyEvaluation()
    }
  };
}

export function getRefereeLabel(role) {
  return role === 'first' ? '1° arbitro' : '2° arbitro';
}

export function getRefereeNumber(role) {
  return role === 'first' ? '1' : '2';
}
