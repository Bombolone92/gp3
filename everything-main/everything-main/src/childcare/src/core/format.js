/** Display helpers for records. Pure functions, safe to unit test. */

export function personName(p, { preferred = true } = {}) {
  if (!p) return 'Unknown';
  const first = (preferred && p.preferredName) || p.firstName || '';
  return [first, p.lastName].filter(Boolean).join(' ').trim() || 'Unnamed';
}

export function firstName(p) {
  return (p && (p.preferredName || p.firstName)) || personName(p);
}

export function initials(name) {
  // Whole characters: composed accents, and letters outside the BMP such as 𠮷.
  const parts = String(name || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => Array.from(p));
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).join('').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function telHref(number) {
  const digits = String(number || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
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

/** Avatar and room colors: distinct hues readable with white text. */
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
