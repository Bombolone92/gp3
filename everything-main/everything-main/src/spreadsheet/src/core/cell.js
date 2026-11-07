/**
 * Cell addressing. Rows and columns are zero-based everywhere inside the app;
 * A1 notation is only produced and consumed at the edges (formulas, the name
 * box, file import/export).
 */

/** 0 → "A", 25 → "Z", 26 → "AA". */
/** The most text a cell can hold, which is also the most an .xlsx file can store per cell. */
export const MAX_TEXT = 32767;

/**
 * The first `max` UTF-16 units of `text`, without half of a surrogate pair at the end: an emoji cut in two is a lone
 * surrogate, which a file or a JSON request (the AI's, which refuses it) cannot carry.
 */
export function cutText(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max).replace(/[\uD800-\uDBFF]$/, '') : s;
}

export function colName(c) {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" → 0, "AA" → 26. Case-insensitive; returns -1 for anything else. */
export function colIndex(name) {
  if (!name || !/^[A-Za-z]+$/.test(name)) return -1;
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Zero-based (r, c) → "B3". */
export function cellName(r, c) {
  return `${colName(c)}${r + 1}`;
}

const A1_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

/**
 * "B3" → { r: 2, c: 1, absR: false, absC: false }; "$B$3" flags both. Null
 * when the text is not a single-cell reference.
 */
export function parseCellRef(text) {
  const m = A1_RE.exec(text || '');
  if (!m) return null;
  const c = colIndex(m[2]);
  const r = parseInt(m[4], 10) - 1;
  if (c < 0 || r < 0) return null;
  return { r, c, absC: m[1] === '$', absR: m[3] === '$' };
}

/**
 * "A1:B3" or "A1" → normalized { r1, c1, r2, c2 } with r1 <= r2, c1 <= c2.
 * Null when it is not a range.
 */
export function parseRange(text) {
  const parts = String(text || '').split(':');
  if (parts.length > 2) return null;
  const a = parseCellRef(parts[0]);
  if (!a) return null;
  const b = parts.length === 2 ? parseCellRef(parts[1]) : a;
  if (!b) return null;
  return normalizeRange({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
}

export function normalizeRange({ r1, c1, r2, c2 }) {
  return {
    r1: Math.min(r1, r2), c1: Math.min(c1, c2),
    r2: Math.max(r1, r2), c2: Math.max(c1, c2),
  };
}

/** { r1, c1, r2, c2 } → "A1:B3" (or "A1" for a single cell). */
export function rangeName(range) {
  const { r1, c1, r2, c2 } = normalizeRange(range);
  const a = cellName(r1, c1);
  if (r1 === r2 && c1 === c2) return a;
  return `${a}:${cellName(r2, c2)}`;
}

export function rangeContains(range, r, c) {
  const n = normalizeRange(range);
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
}

export function rangeSize(range) {
  const n = normalizeRange(range);
  return { rows: n.r2 - n.r1 + 1, cols: n.c2 - n.c1 + 1 };
}

/** Stable map key for a cell. */
export function cellKey(r, c) {
  return `${r},${c}`;
}

export function parseKey(key) {
  const i = key.indexOf(',');
  return { r: Number(key.slice(0, i)), c: Number(key.slice(i + 1)) };
}
