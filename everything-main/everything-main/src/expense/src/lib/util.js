/** Small shared helpers with no DOM or Puter dependency. */

/** Collision-resistant id: time prefix keeps ids roughly sortable. */
export function uid() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}${r}`;
}

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function sum(values) {
  let total = 0;
  for (const v of values) total += Number(v) || 0;
  return round2(total);
}

/** Group an array into a Map keyed by fn(item), preserving first-seen order. */
export function groupBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function pluralize(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Lowercase, strip punctuation and collapse whitespace, for fuzzy compares. */
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens worth comparing between merchant names and statement descriptions. */
const STOP = new Set(['the', 'and', 'inc', 'llc', 'ltd', 'co', 'corp', 'of', 'a', 'an', 'pos', 'card', 'purchase', 'payment', 'debit', 'credit', 'www', 'com']);
export function tokens(s) {
  return normalizeText(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

export function safeFilename(name, fallback = 'file') {
  const clean = String(name || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
}

export function extensionFor(mime, name = '') {
  const fromName = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (fromName && fromName.length <= 5) return fromName;
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif', 'application/pdf': 'pdf' };
  return map[mime] || 'bin';
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
