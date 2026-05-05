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
  getReport: (id) => request(`/api/reports/${id}`),
  createReport: (report, status) => request('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ report, status })
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
    request(`/api/referees/${refereeId}/photo`, { method: 'DELETE' })
};

export function downloadReportPdf(reportId, role) {
  const link = document.createElement('a');
  link.href = `/api/reports/${reportId}/export/${role}/download`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
