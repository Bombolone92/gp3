/** Short unique id, time-prefixed so ids sort roughly by creation. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** Round to 2 decimals without float drift on common money values. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Escape a string for safe interpolation into HTML. */
export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** clamp(n, lo, hi) */
export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** "1.2 MB" — a file size as a person reads it, not as a byte count. */
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
