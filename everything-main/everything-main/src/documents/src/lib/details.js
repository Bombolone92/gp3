/**
 * Facts about the open document for the details dialog: where the file
 * lives, how big it is, when it was created, changed, and last saved, how
 * long it is, and whether it is published. Pure formatting; the dialog
 * gathers the values.
 */

import { formatBytes, relativeTime } from '../ui/dom.js';

/** "Documents" for "Documents/Report.docx"; "" for a bare name. */
export function folderOf(path) {
  const p = String(path || '');
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
}

/** "Report.docx" for "Documents/Report.docx"; "" without a path. */
export function fileNameOf(path) {
  const p = String(path || '');
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Seconds or milliseconds since the epoch -> milliseconds; null when missing. */
export function toMillis(ts) {
  if (ts == null || ts === '') return null;
  const n = typeof ts === 'number' ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

/** "Aug 28, 2026, 11:20 AM (2 hours ago)" or "" when unknown. */
export function whenText(ts, now = Date.now()) {
  const ms = toMillis(ts);
  if (!ms) return '';
  const date = new Date(ms);
  const absolute = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const rel = relativeTime(ms, now);
  // Older dates come back from relativeTime as a date rather than "3 days
  // ago"; compared as the same formatted string so every locale is handled.
  const isDate = rel === date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return rel && !isDate ? `${absolute} (${rel.charAt(0).toLowerCase()}${rel.slice(1)})` : absolute;
}

/**
 * The rows of the details dialog, in order: [{ label, value }]. Rows with
 * nothing to show are left out, except the ones that say so ("Not saved
 * yet", "Not published").
 */
export function detailRows({ name, path, size, created, modified, lastSaved, pages, words, publishedUrl, saved = true }, { now = Date.now() } = {}) {
  const rows = [];
  // The file as it is on the drive: a .dotx or .docm opened as it stands keeps
  // its own extension until the first save writes a .docx copy. Only a document
  // with nowhere to live yet is named for the file it is about to become.
  rows.push({ label: 'Name', value: fileNameOf(path) || `${name || 'Untitled document'}.docx` });
  const folder = folderOf(path);
  rows.push({ label: 'Location', value: path ? (folder ? `${folder}/ on your Puter drive` : 'The root of your Puter drive') : 'Not saved yet' });
  if (path && size != null) rows.push({ label: 'Size', value: formatBytes(size) });
  if (path && created) rows.push({ label: 'Created', value: whenText(created, now) });
  if (path && modified) rows.push({ label: 'Modified', value: whenText(modified, now) });
  if (path) rows.push({ label: 'Last saved here', value: lastSaved ? whenText(lastSaved, now) : (saved ? 'Unchanged since it was opened' : 'Not yet, this session') });
  if (pages != null || words != null) {
    const parts = [];
    if (pages != null) parts.push(`${pages.toLocaleString()} ${pages === 1 ? 'page' : 'pages'}`);
    if (words != null) parts.push(`${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`);
    rows.push({ label: 'Length', value: parts.join(', ') });
  }
  if (publishedUrl !== undefined) rows.push({ label: 'Published', value: publishedUrl || 'Not published' });
  return rows;
}
