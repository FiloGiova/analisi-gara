export function getHashPath() {
  return window.location.hash.replace(/^#\/?/, '') || '';
}

export function navigate(path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  window.location.hash = `/${cleanPath}`;
}

export function parseRoute(path) {
  const [purePath, queryString = ''] = path.split('?');
  const segments = purePath.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryString));

  if (!segments.length) return { name: 'home' };
  if (segments[0] === 'account') return { name: 'account' };
  if (segments[0] === 'me') return { name: 'refereeHome' };
  if (segments[0] === 'observers' && segments[1]) return { name: 'observerDetail', id: Number(segments[1]) };
  if (segments[0] === 'observers') return { name: 'observers' };
  if (segments[0] === 'admin' && segments[1] === 'users') return { name: 'adminUsers' };
  if (segments[0] === 'admin' && segments[1] === 'logs') return { name: 'adminLogs' };
  if (segments[0] === 'admin' && segments[1] === 'competitions') return { name: 'adminCompetitions' };
  if (segments[0] === 'admin' && segments[1] === 'sources') return { name: 'adminSources' };
  if (segments[0] === 'admin' && segments[1] === 'imports') return { name: 'adminImports' };
  if (segments[0] === 'coverage') return { name: 'coverage' };
  if (segments[0] === 'admin' && segments[1] === 'referees' && segments[2]) {
    return { name: 'adminRefereeDetail', id: Number(segments[2]) };
  }
  if (segments[0] === 'admin' && segments[1] === 'referees') return { name: 'adminReferees' };
  if (segments[0] === 'games' && segments[1] === 'designate') return { name: 'designateObservers' };
  if (segments[0] === 'games' && segments[1]) return { name: 'gameDetail', id: Number(segments[1]) };
  if (segments[0] === 'games') return { name: 'games' };
  if (segments[0] === 'reports' && segments.length === 1) return { name: 'dashboard' };
  if (segments[0] === 'reports' && segments[1] === 'new') {
    return { name: 'newReport', gameId: query.game ? Number(query.game) : null };
  }
  if (segments[0] === 'reports' && segments[1] && segments[2] === 'edit') {
    return { name: 'editReport', id: Number(segments[1]) };
  }
  if (segments[0] === 'reports' && segments[1]) return { name: 'reportDetail', id: Number(segments[1]) };

  return { name: 'notFound' };
}
