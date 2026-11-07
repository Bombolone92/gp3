/**
 * Display helpers for records. Pure functions, safe to unit test.
 *
 * Shared record shapes:
 *   address: { street, street2, city, state, zip, country }
 *   people (tenants, owners, vendors, applicants): firstName, lastName,
 *     company, emails: string[], phones: string[]
 */

/** "Maya Alvarez", or the company when there is no person name. */
export function personName(p) {
  if (!p) return '';
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return name || p.company || 'Unnamed';
}

/** Owners and vendors: the company first, unless the record is a person. */
export function displayName(p) {
  if (!p) return '';
  if (p.company && p.kind !== 'person') return p.company;
  return personName(p);
}

/** The other name: the contact person for a company, or the company for a person. */
export function secondaryName(p) {
  if (!p) return '';
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return displayName(p) === p.company ? name : p.company || '';
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

export function formatAddress(a, { multiline = false } = {}) {
  if (!a) return '';
  const line2 = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const lines = [a.street, a.street2, line2, a.country].filter((s) => s && String(s).trim());
  return lines.join(multiline ? '\n' : ', ');
}

export function shortAddress(a) {
  if (!a) return '';
  return [a.street, a.city].filter(Boolean).join(', ');
}

export function mapsUrl(a) {
  const q = formatAddress(a);
  return q ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` : null;
}

export function primaryPhone(p) {
  return (p?.phones || []).find(Boolean) || '';
}

export function primaryEmail(p) {
  return (p?.emails || []).find(Boolean) || '';
}

export function telHref(number) {
  const digits = String(number || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

export function pluralize(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "WO-12", "TK-4", "L-1001" */
export function recordNumber(prefix, n) {
  return n ? `${prefix}-${n}` : '';
}

export function percent(n, digits = 0) {
  return `${(Number(n) || 0).toFixed(digits)}%`;
}

/** Team member colors: distinct hues readable with white text. */
export const TEAM_COLORS = ['#1f5bd0', '#0b7a5e', '#b4441c', '#7a3fc2', '#b0306a', '#4b6b16', '#a1520b', '#2f6f9f', '#55606e', '#8e2f2f'];

export function colorFor(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length];
}

// Letters that do not decompose into a base letter and an accent.
const FOLD = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', ħ: 'h', ı: 'i', æ: 'ae', œ: 'oe', ß: 'ss', þ: 'th' };

/** Case- and accent-insensitive search normalization. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[łøđðħıæœßþ]/g, (c) => FOLD[c]);
}

export function matches(haystack, query) {
  const q = normalize(query).trim();
  if (!q) return true;
  const h = normalize(haystack);
  return q.split(/\s+/).every((t) => h.includes(t));
}

/** Split a comma or newline separated input into trimmed values. */
export function splitList(s) {
  return String(s || '')
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
