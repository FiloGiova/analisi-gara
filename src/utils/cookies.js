import { config, getSessionMaxAgeMs } from '../config.js';

export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function getCookie(req, name) {
  return parseCookies(req.headers.cookie || '')[name];
}

export function buildSessionCookie(token) {
  const parts = [
    `${encodeURIComponent(config.sessionCookieName)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(getSessionMaxAgeMs() / 1000)}`
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie() {
  const parts = [
    `${encodeURIComponent(config.sessionCookieName)}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}
