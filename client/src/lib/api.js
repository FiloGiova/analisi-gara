export class ApiError extends Error {
  constructor(message, details, status) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(data?.message || 'Errore di comunicazione.', data?.details, response.status);
  }

  return data;
}

export const api = {
  me: () => request('/api/auth/me'),
  myReports: ({ search = '', status = '', season = '' } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (season) params.set('season', season);
    return request(`/api/me/reports${params.toString() ? `?${params}` : ''}`);
  },
  myStats: ({ season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/me/stats${params.toString() ? `?${params}` : ''}`);
  },
  listAvailableSeasons: () => request('/api/me/seasons'),
  myProfile: () => request('/api/me/profile'),
  updateMyProfile: ({ displayName }) => request('/api/me/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName })
  }),
  login: (username, password) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  changePassword: ({ currentPassword, newPassword }) => request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  }),
  listUsers: () => request('/api/users'),
  createUser: (user) => request('/api/users', {
    method: 'POST',
    body: JSON.stringify(user)
  }),
  updateUser: (id, user) => request(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(user)
  }),
  resetUserPassword: (id, password) => request(`/api/users/${id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password })
  }),
  getReportStats: ({ season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/reports/stats${params.toString() ? `?${params}` : ''}`);
  },
  isEmailEnabled: () => request('/api/reports/email-enabled'),
  sendReportEmail: (id, role) => request(`/api/reports/${id}/send-email/${role}`, { method: 'POST' }),
  listReports: ({ search = '', status = '', season = '', observer = '' } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (season) params.set('season', season);
    if (observer) params.set('observer', observer);
    return request(`/api/reports${params.toString() ? `?${params}` : ''}`);
  },
  listReportObservers: ({ season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/reports/observers${params.toString() ? `?${params}` : ''}`);
  },
  getPendingGames: ({ season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/reports/pending-games${params.toString() ? `?${params}` : ''}`);
  },
  getReport: (id) => request(`/api/reports/${id}`),
  createReport: (report, status, { allowDuplicate = false } = {}) => request('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ report, status, allowDuplicate })
  }),
  updateReport: (id, report, status) => request(`/api/reports/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ report, status })
  }),
  deleteReport: (id) => request(`/api/reports/${id}`, { method: 'DELETE' }),
  exportReport: (id) => request(`/api/reports/${id}/export`, { method: 'POST' }),
  getRefereeNames: () => request('/api/reports/referee-names'),
  listAccessLogs: (limit = 100, offset = 0) =>
    request(`/api/access-logs?limit=${limit}&offset=${offset}`),
  listReferees: ({ competition = '', season = '', activeOnly = false } = {}) => {
    const params = new URLSearchParams();
    if (competition) params.set('competition', competition);
    if (season) params.set('season', season);
    if (activeOnly) params.set('activeOnly', 'true');
    return request(`/api/referees${params.toString() ? `?${params}` : ''}`);
  },
  listRefereeSeasons: ({ competition = '' } = {}) => {
    const params = new URLSearchParams();
    if (competition) params.set('competition', competition);
    return request(`/api/referees/seasons${params.toString() ? `?${params}` : ''}`);
  },
  getRefereeRanking: ({ season = '', competition = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (competition) params.set('competition', competition);
    return request(`/api/referees/ranking${params.toString() ? `?${params}` : ''}`);
  },
  getReferee: (id, { season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/referees/${id}${params.toString() ? `?${params}` : ''}`);
  },
  createReferee: (data) => request('/api/referees', { method: 'POST', body: JSON.stringify(data) }),
  updateReferee: (id, data) => request(`/api/referees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getRefereeProgress: (id, { season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/referees/${id}/progress${params.toString() ? `?${params}` : ''}`);
  },
  getRefereeRosters: (id) => request(`/api/referees/${id}/rosters`),
  addRefereeRoster: (id, data) => request(`/api/referees/${id}/rosters`, { method: 'POST', body: JSON.stringify(data) }),
  removeRefereeRoster: (refereeId, rosterId) =>
    request(`/api/referees/${refereeId}/rosters/${rosterId}`, { method: 'DELETE' }),
  listRefereeBands: ({ competition = '', season = '', band = '' } = {}) => {
    const params = new URLSearchParams();
    if (competition) params.set('competition', competition);
    if (season) params.set('season', season);
    if (band) params.set('band', band);
    return request(`/api/referees/bands${params.toString() ? `?${params}` : ''}`);
  },
  addRefereeBand: (refereeId, data) =>
    request(`/api/referees/${refereeId}/bands`, { method: 'POST', body: JSON.stringify(data) }),
  removeRefereeBand: (bandId) => request(`/api/referees/bands/${bandId}`, { method: 'DELETE' }),
  uploadMyPhoto: async (file) => {
    const form = new FormData();
    form.append('photo', file);
    const response = await fetch('/api/me/photo', {
      method: 'POST',
      body: form,
      credentials: 'include'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data?.message || 'Upload non riuscito.', data?.details, response.status);
    return data;
  },
  deleteMyPhoto: () => request('/api/me/photo', { method: 'DELETE' }),
  uploadRefereePhoto: async (refereeId, file) => {
    const form = new FormData();
    form.append('photo', file);
    const response = await fetch(`/api/referees/${refereeId}/photo`, {
      method: 'POST',
      body: form,
      credentials: 'include'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data?.message || 'Upload non riuscito.', data?.details, response.status);
    return data;
  },
  deleteRefereePhoto: (refereeId) =>
    request(`/api/referees/${refereeId}/photo`, { method: 'DELETE' }),
  listGames: ({ season = '', matchday = '', status = '', search = '', refereeId = '', observerUserId = '', uncovered = false, sourceId = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (matchday) params.set('matchday', matchday);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (refereeId) params.set('refereeId', refereeId);
    if (observerUserId) params.set('observerUserId', observerUserId);
    if (uncovered) params.set('uncovered', 'true');
    if (sourceId) params.set('sourceId', sourceId);
    return request(`/api/games${params.toString() ? `?${params}` : ''}`);
  },
  listGameSeasons: () => request('/api/games/seasons'),
  listGameObservers: () => request('/api/games/observers'),
  getGame: (id) => request(`/api/games/${id}`),
  getGameReportPrefill: (id) => request(`/api/games/${id}/report-prefill`),
  createGame: (data) => request('/api/games', { method: 'POST', body: JSON.stringify(data) }),
  updateGame: (id, data) => request(`/api/games/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGame: (id) => request(`/api/games/${id}`, { method: 'DELETE' }),
  setGameOfficial: (gameId, role, data) =>
    request(`/api/games/${gameId}/officials/${role}`, { method: 'PUT', body: JSON.stringify(data) }),
  removeGameOfficial: (gameId, role) =>
    request(`/api/games/${gameId}/officials/${role}`, { method: 'DELETE' }),
  saveGameAlias: ({ source, externalName, refereeId, userId }) =>
    request('/api/games/aliases', { method: 'POST', body: JSON.stringify({ source, externalName, refereeId, userId }) }),
  getAliasCandidates: (name, type = 'referee') =>
    request(`/api/games/alias-candidates?name=${encodeURIComponent(name)}&type=${type}`),
  getObserverSuggestions: (gameId) =>
    request(`/api/games/${gameId}/observer-suggestions`),
  getStatsPhases: ({ season = '', competition = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (competition) params.set('competition', competition);
    return request(`/api/stats/phases${params.toString() ? `?${params}` : ''}`);
  },
  getCoverage: ({ season = '', competition = '', band = '', phaseIds = [] } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (competition) params.set('competition', competition);
    if (band) params.set('band', band);
    if (phaseIds.length) params.set('phases', phaseIds.join(','));
    return request(`/api/stats/coverage${params.toString() ? `?${params}` : ''}`);
  },
  getEmployment: ({ season = '', competition = '', band = '', phaseIds = [] } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (competition) params.set('competition', competition);
    if (band) params.set('band', band);
    if (phaseIds.length) params.set('phases', phaseIds.join(','));
    return request(`/api/stats/employment${params.toString() ? `?${params}` : ''}`);
  },
  getMatrix: ({ season = '', competition = '', band = '', phaseIds = [] } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (competition) params.set('competition', competition);
    if (band) params.set('band', band);
    if (phaseIds.length) params.set('phases', phaseIds.join(','));
    return request(`/api/stats/matrix${params.toString() ? `?${params}` : ''}`);
  },
  getMatrixDetail: ({ season = '', competition = '', phaseIds = [], observerKey, refereeId }) => {
    const params = new URLSearchParams({ observerKey, refereeId: String(refereeId) });
    if (season) params.set('season', season);
    if (competition) params.set('competition', competition);
    if (phaseIds.length) params.set('phases', phaseIds.join(','));
    return request(`/api/stats/matrix-detail?${params}`);
  },
  previewDesignationsImport: async (file, season) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`/api/imports/preview?season=${encodeURIComponent(season)}`, {
      method: 'POST',
      body: form,
      credentials: 'include'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data?.message || 'Anteprima non riuscita.', data?.details, response.status);
    return data;
  },
  applyDesignationsImport: ({ sportSeason, rows }) =>
    request('/api/imports/apply', { method: 'POST', body: JSON.stringify({ sportSeason, rows }) }),
  listSources: ({ season = '' } = {}) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return request(`/api/sources${params.toString() ? `?${params}` : ''}`);
  },
  createSource: (data) => request('/api/sources', { method: 'POST', body: JSON.stringify(data) }),
  updateSource: (id, data) => request(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSource: (id) => request(`/api/sources/${id}`, { method: 'DELETE' }),
  syncSource: (id) => request(`/api/sources/${id}/sync`, { method: 'POST' }),
  listSourceRuns: (id) => request(`/api/sources/${id}/runs`),
  generateJudgment: (reportData) =>
    request('/api/ai/generate-judgment', {
      method: 'POST',
      body: JSON.stringify({ reportData })
    }),
  reviseJudgment: ({ currentJudgment, observerFeedback }) =>
    request('/api/ai/revise-judgment', {
      method: 'POST',
      body: JSON.stringify({ currentJudgment, observerFeedback })
    })
};

export function downloadDesignationsTemplate(season, phaseIds = []) {
  const params = new URLSearchParams({ season });
  if (phaseIds.length) params.set('phases', phaseIds.join(','));
  const link = document.createElement('a');
  link.href = `/api/imports/template?${params}`;
  link.setAttribute('download', '');
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 200);
}

export function downloadStatsExport({
  view,
  season = '',
  competition = '',
  band = '',
  phaseIds = [],
  search = '',
  sortKey = '',
  sortDirection = 'asc'
}) {
  const params = new URLSearchParams({ view });
  if (season) params.set('season', season);
  if (competition) params.set('competition', competition);
  if (band) params.set('band', band);
  if (phaseIds.length) params.set('phases', phaseIds.join(','));
  if (search.trim()) params.set('search', search.trim());
  if (sortKey) params.set('sort', sortKey);
  params.set('direction', sortDirection);
  const link = document.createElement('a');
  link.href = `/api/stats/export?${params}`;
  link.setAttribute('download', '');
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 200);
}

export function downloadGamesExport({
  season = '',
  matchday = '',
  stateFilters = [],
  sourceNames = [],
  refereeId = '',
  search = ''
}) {
  const params = new URLSearchParams();
  if (season) params.set('season', season);
  if (matchday) params.set('matchday', matchday);
  stateFilters.forEach((state) => params.append('states', state));
  sourceNames.forEach((source) => params.append('sources', source));
  if (refereeId) params.set('refereeId', refereeId);
  if (search) params.set('search', search);
  const link = document.createElement('a');
  link.href = `/api/games/export?${params}`;
  link.setAttribute('download', '');
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 200);
}

export function downloadRefereesExport({
  season = '',
  competition = '',
  activeFilter = '',
  band = '',
  search = ''
}) {
  const params = new URLSearchParams();
  if (season) params.set('season', season);
  if (competition) params.set('competition', competition);
  if (activeFilter) params.set('active', activeFilter);
  if (band) params.set('band', band);
  if (search) params.set('search', search);
  const link = document.createElement('a');
  link.href = `/api/referees/export?${params}`;
  link.setAttribute('download', '');
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 200);
}

export function downloadReportPdf(reportId, role) {
  const link = document.createElement('a');
  link.href = `/api/reports/${reportId}/export/${role}/download`;
  link.setAttribute('download', '');
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 200);
}
