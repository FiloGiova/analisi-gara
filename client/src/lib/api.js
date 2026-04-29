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
  listReports: ({ search = '', status = '' } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    return request(`/api/reports${params.toString() ? `?${params}` : ''}`);
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
  getRefereeNames: () => request('/api/reports/referee-names')
};

export function downloadReportPdf(reportId, role) {
  const link = document.createElement('a');
  link.href = `/api/reports/${reportId}/export/${role}/download`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
