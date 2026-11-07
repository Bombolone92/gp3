/** Collision-safe id: time prefix keeps ids roughly sortable by creation. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Round to 2 decimals, half away from zero (money display math). */
export function round2(n) {
  return Math.sign(n) * Math.round(Math.abs(n) * 100) / 100;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** '1 sale' / '3 sales' - a count with its noun agreed. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The avatar/tile initial: first code point, upper-cased. charAt(0) hands
 * back half a surrogate pair when the name starts with an emoji or an
 * astral-plane character - a replacement glyph where the letter goes.
 */
export function initialOf(name) {
  return ([...String(name || '')][0] || '').toUpperCase();
}

/** Combining diacritical marks, stripped after NFD for accent-insensitive search. */
const DIACRITICS = /[\u0300-\u036f]/g;

/** Case- and accent-insensitive haystack match for search boxes. */
export function matches(haystack, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(haystack || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .includes(q.normalize('NFD').replace(DIACRITICS, ''));
}
