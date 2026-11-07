import { dateFormat } from './dates.js';

/* The shape the fallback below prints, held so its formatter is built once:
   a list draws one of these per row (see lib/dates.js). */
const RELATIVE_FALLBACK = { month: 'short', day: 'numeric' };

/** Short unique id: time component keeps ids roughly sortable by creation. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Ids exist only to tie a <label for> to its control, so a counter is enough
   and reads better in the inspector than a random string. */
let fieldSeq = 0;
export function fieldId(prefix = 'field') {
  fieldSeq += 1;
  return `${prefix}-${fieldSeq}`;
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** "Nadia Farias" → "NF", "alex" → "A". Used for avatar chips. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/* Ink for a swatch the user picked. The member palette runs from a deep
   purple to a mid amber, and white initials sit at 3.2:1 on the lighter end —
   so the letters follow the fill rather than assuming it is dark, the same
   way --accent-ink and --danger-ink do for the fixed colours. */
const SWATCH_INK_DARK = '#17171a';
const SWATCH_INK_LIGHT = '#ffffff';

/** WCAG relative luminance of a #rgb / #rrggbb colour, or null if unparsable. */
function relativeLuminance(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whichever of black or white contrasts better with `background`.
 * Returns null for anything that is not a plain hex (a CSS variable, say), so
 * the caller can fall back to the stylesheet.
 */
export function readableInk(background) {
  const l = relativeLuminance(background);
  if (l === null) return null;
  const onLight = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (relativeLuminance(SWATCH_INK_DARK) + 0.05);
  return onDark > onLight ? SWATCH_INK_DARK : SWATCH_INK_LIGHT;
}

/** Bytes → "1.2 MB" style label. */
export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Timestamp → "just now", "5m ago", "3d ago", or a short date. */
export function relativeTime(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dateFormat(RELATIVE_FALLBACK).format(new Date(ts));
}

/** Keep a filename safe for a Puter fs path segment. */
export function safeFileName(name) {
  const trimmed = String(name || 'file').trim() || 'file';
  return trimmed.replace(/[/\\:*?"<>|]/g, '_').slice(0, 120);
}
