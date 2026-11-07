/** Display formatting helpers. Pure functions; `now` is injectable for tests. */

// List timestamp: time for today, "Aug 12" this year, "Aug 12, 2025" before.
export const formatWhen = (message, now = new Date()) => {
  const when = message.date ?? (message.modified ? new Date(message.modified * 1000) : null);
  if (!when || Number.isNaN(when.valueOf())) return message.day ?? '';
  if (now.toDateString() === when.toDateString()) {
    return when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const opts = { month: 'short', day: 'numeric' };
  if (now.getFullYear() !== when.getFullYear()) opts.year = 'numeric';
  return when.toLocaleDateString([], opts);
};

// Reader timestamp: the full moment, e.g. "Tue, Aug 19, 2026, 9:24 AM".
export const formatFullDate = (date) => {
  if (!date || Number.isNaN(date.valueOf())) return '';
  return date.toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

/**
 * The first character of a string as a reader sees it: one grapheme, which
 * for an emoji or an accented letter written as base + combining mark is more
 * than one UTF-16 code unit. Indexing the string took the first code unit
 * alone, and for a name beginning with an emoji -- which is what half the
 * newsletters call themselves -- that is an unpaired surrogate, drawn as a
 * broken-glyph box in the avatar.
 */
const firstGrapheme = (text) => {
  if (!text) return '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const [first] = new Intl.Segmenter().segment(text);
    return first?.segment ?? '';
  }
  return String.fromCodePoint(text.codePointAt(0));
};

// First letter of the display name (or address) for the avatar.
export const initialFor = (name = '') => {
  const ch = firstGrapheme(name.trim().replace(/^["'<(]+/, ''));
  return ch ? ch.toUpperCase() : '?';
};

// Deterministic hue per sender so avatars are stable across sessions.
export const hueFor = (str = '') => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return ((hash % 360) + 360) % 360;
};

/**
 * Cut a string to `end` UTF-16 units without splitting a character in half.
 * An emoji is two units, and a cut that falls between them leaves an
 * unpaired surrogate -- drawn as the same broken-glyph box `initialFor`
 * used to put in the avatar, and in the same mail: the newsletters whose
 * preview line is a run of emoji.
 */
const cutAt = (text, end) => {
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
};

// Collapse a body extract into a single list-row preview line.
export const cleanSnippet = (text = '', max = 140) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${cutAt(flat, max - 1).trimEnd()}…` : flat;
};

export const formatSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  // Branch on the rounded figure: picking the unit from the raw one let
  // rounding overflow it, so a file just under a megabyte read "1024 KB".
  const kb = (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0);
  if (Number(kb) < 1024) return `${kb} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
