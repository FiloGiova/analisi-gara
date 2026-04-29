export function getHashPath() {
  return window.location.hash.replace(/^#\/?/, '') || '';
}

export function navigate(path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  window.location.hash = `/${cleanPath}`;
}

export function parseRoute(path) {
  const segments = path.split('/').filter(Boolean);

  if (!segments.length) return { name: 'dashboard' };
  if (segments[0] === 'admin' && segments[1] === 'users') return { name: 'adminUsers' };
  if (segments[0] === 'reports' && segments[1] === 'new') return { name: 'newReport' };
  if (segments[0] === 'reports' && segments[1] && segments[2] === 'edit') {
    return { name: 'editReport', id: Number(segments[1]) };
  }
  if (segments[0] === 'reports' && segments[1]) return { name: 'reportDetail', id: Number(segments[1]) };

  return { name: 'notFound' };
}
