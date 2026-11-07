/** Display helpers for records. Pure functions, safe to unit test. */

/** A contact's display name: company name, or "First Middle Last". */
export function contactName(c) {
  if (!c) return 'Unknown contact';
  if (c.type === 'company') return c.companyName || 'Unnamed company';
  const name = [c.prefix, c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ').trim();
  return name || 'Unnamed contact';
}

/** "Last, First" for sorted lists of people. */
export function contactSortName(c) {
  if (!c) return '';
  if (c.type === 'company') return c.companyName || '';
  return [c.lastName, c.firstName].filter(Boolean).join(', ');
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
  const line2 = [a.city, [a.region, a.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const lines = [a.street, a.street2, line2, a.country].filter((s) => s && String(s).trim());
  return lines.join(multiline ? '\n' : ', ');
}

export function primaryOf(list, field) {
  if (!Array.isArray(list) || !list.length) return '';
  const p = list.find((x) => x.primary && x[field]) || list.find((x) => x[field]);
  return p ? p[field] : '';
}

export const primaryEmail = (c) => primaryOf(c?.emails, 'address');
export const primaryPhone = (c) => primaryOf(c?.phones, 'number');

export function telHref(number) {
  const digits = String(number || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

/** Matter label: "00012-Lopez: Estate planning" style. */
export function matterLabel(m) {
  if (!m) return 'Unknown matter';
  return m.displayNumber ? `${m.displayNumber} ${m.description || ''}`.trim() : m.description || 'Untitled matter';
}

export function pluralize(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Distinct hues readable with white text, used for firm users and calendars. */
export const PALETTE = ['#2a5bd7', '#0f7b6c', '#b4441c', '#7a3fc2', '#b0306a', '#4b6b16', '#a1520b', '#2f6f9f', '#55606e', '#8e2f2f'];

export function colorFor(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Letters that carry no combining accent in Unicode, and apostrophe variants.
const FOLD = { ł: 'l', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', đ: 'd', ð: 'd', þ: 'th', ı: 'i', '’': "'", '‘': "'", ʼ: "'", '`': "'", '´': "'" };

/** Case- and accent-insensitive search normalization. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[łøßæœđðþı’‘ʼ`´]/g, (c) => FOLD[c]);
}

/** Every word of the query appears somewhere in the haystack. */
export function matches(haystack, query) {
  const q = normalize(query).trim();
  if (!q) return true;
  const h = normalize(haystack);
  return q.split(/\s+/).every((t) => h.includes(t));
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Zero-padded matter or bill number. */
export function padNumber(n, width = 5) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(width, '0');
}
