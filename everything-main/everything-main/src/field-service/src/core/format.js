/** Display helpers for records. Pure functions, safe to unit test. */

export function clientName(c) {
  if (!c) return 'Unknown client';
  const person = [c.title, c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  if (c.useCompanyName && c.company) return c.company;
  return person || c.company || 'Unnamed client';
}

export function clientSecondary(c) {
  if (!c) return '';
  if (c.useCompanyName && c.company) return [c.firstName, c.lastName].filter(Boolean).join(' ');
  return c.company || '';
}

export function initials(name) {
  const parts = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatAddress(p, { multiline = false } = {}) {
  if (!p) return '';
  const line2 = [p.city, [p.region, p.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const lines = [p.street1, p.street2, line2, p.country].filter((s) => s && String(s).trim());
  return lines.join(multiline ? '\n' : ', ');
}

export function shortAddress(p) {
  if (!p) return '';
  return [p.street1, p.city].filter(Boolean).join(', ');
}

export function mapsUrl(p) {
  const q = formatAddress(p);
  return q ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` : null;
}

export function directionsUrl(p) {
  const q = formatAddress(p);
  return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null;
}

export function primaryPhone(c) {
  return c?.phones?.find((p) => p.number)?.number || '';
}

export function primaryEmail(c) {
  return c?.emails?.find((e) => e.address)?.address || '';
}

export function telHref(number) {
  // An extension ("ext. 23", "x23", "#23") is dialled after a pause, and the
  // "(0)" in "+44 (0) 20" is not dialled after a country code.
  const [, main, ext] = /^(.*?)(?:\s*(?:ext\.?|extension|x|#)\s*(\d+))?\s*$/i.exec(String(number || ''));
  const digits = (main.trim().startsWith('+') ? main.replace(/\(0\)/, '') : main).replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}${ext ? `,${ext}` : ''}` : null;
}

export const DOC_PREFIX = { quotes: 'Quote', jobs: 'Job', invoices: 'Invoice', requests: 'Request' };

export function docLabel(coll, rec) {
  if (!rec) return '';
  return rec.number ? `${DOC_PREFIX[coll]} #${rec.number}` : DOC_PREFIX[coll];
}

export function pluralize(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatHours(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  if (!hrs) return `${mins}m`;
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`;
}

export function formatDecimalHours(minutes) {
  return (Math.round(((minutes || 0) / 60) * 100) / 100).toFixed(2);
}

/** Team member colors: distinct hues readable with white text. */
export const TEAM_COLORS = ['#1f5bd0', '#0f7b6c', '#b4441c', '#7a3fc2', '#b0306a', '#4b6b16', '#a1520b', '#2f6f9f', '#55606e', '#8e2f2f'];

export function colorFor(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length];
}

/** Case- and accent-insensitive search normalization. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function matches(haystack, query) {
  const q = normalize(query).trim();
  if (!q) return true;
  const h = normalize(haystack);
  return q.split(/\s+/).every((t) => h.includes(t));
}

/**
 * A multi-stop driving route through properties, in order. Starts from the
 * business address when one is set. Returns null without two stops.
 */
export function routeUrl(properties, origin = '') {
  const stops = properties.map((p) => formatAddress(p)).filter(Boolean);
  if (!stops.length || (stops.length < 2 && !origin)) return null;
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).slice(0, 9);
  const q = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
  if (origin) q.set('origin', origin);
  if (waypoints.length) q.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}
