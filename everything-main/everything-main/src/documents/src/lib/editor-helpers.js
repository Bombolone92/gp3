/** App-authored helpers retained for export/import utilities during the canvas migration. */
import { isMod } from '../ui/dom.js';
import { readDocumentText } from './document-text.js';
const ZOOM_STEPS = [50, 75, 90, 100, 125, 150, 200];
// The engine's zoom slice reports its fit-to-width limits as min/max; the
// app decides how far manual zoom goes.
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const FIT_PADDING = 24; // canvas margin on each side of the page when fitting
const CSS_PX_PER_INCH = 96;

/**
 * Zoom (percent) that fits a page of `pageWidthIn` inches into `hostWidth`
 * pixels with a margin on each side, clamped to the engine's range.
 */
export function fitWidthZoom(hostWidth, pageWidthIn, { min = 10, max = 100, padding = FIT_PADDING } = {}) {
  if (!(hostWidth > 0) || !(pageWidthIn > 0)) return null;
  const raw = ((hostWidth - 2 * padding) / (pageWidthIn * CSS_PX_PER_INCH)) * 100;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

/**
 * Zoom (percent) that shows a whole page: the smaller of the width and
 * height fits, with a margin on every side.
 */
export function fitPageZoom(hostWidth, hostHeight, pageWidthIn, pageHeightIn, { min = 10, max = 100, padding = FIT_PADDING } = {}) {
  if (!(hostHeight > 0) || !(pageHeightIn > 0)) return fitWidthZoom(hostWidth, pageWidthIn, { min, max, padding });
  const byWidth = fitWidthZoom(hostWidth, pageWidthIn, { min: 0, max: Infinity, padding });
  const byHeight = ((hostHeight - 2 * padding) / (pageHeightIn * CSS_PX_PER_INCH)) * 100;
  if (byWidth == null) return null;
  return Math.max(min, Math.min(max, Math.floor(Math.min(byWidth, byHeight))));
}
const MAX_IMAGE_WIDTH = 620; // ~6.5in of a Letter page at 96dpi
let imageHintShown = false; // the right-click hint after the first image, once per session

/** Turn user-typed link text into an absolute URL, or null when it is not one. */
export function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  // A destination has to follow the scheme or the hash: a bare "mailto:" or "#" would be a link that opens nothing.
  if (/^(mailto:|tel:|#)\S+$/i.test(raw)) return raw;
  if (/^(mailto:|tel:|#)/i.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol)) return null;
    // URL has already validated bracketed IPv6 literals.
    if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !u.hostname.startsWith('[')) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Today's date the way a letter would carry it, in the user's locale. */
export function formatToday(date = new Date(), locale = undefined) {
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * A standalone page for printing: Letter width, one-inch margins, black on
 * white. The same page is downloaded as .html and served as the published
 * web page, so it also has to read on a phone: the viewport tag keeps the
 * browser from laying it out at desktop width, a side gutter keeps the text
 * off the screen edges, and long addresses wrap instead of scrolling the
 * page sideways. Printing takes its measurements from the `@page` rule, so
 * the gutter comes off there.
 */
/**
 * The letter of a shortcut chord: the key typed, or the physical key when
 * the layout types another script (Cyrillic, Greek, Hebrew, Arabic), where
 * Ctrl+S arrives as "ы" on a key whose code is still KeyS.
 */
export function shortcutLetter(e) {
  const key = String(e.key || '');
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  const physical = /^Key([A-Z])$/.exec(e.code || '');
  return physical ? physical[1].toLowerCase() : key.toLowerCase();
}

const PUNCTUATION = { '.': 'period', '>': 'period', ',': 'comma', '<': 'comma', '=': 'equal', '+': 'equal', '-': 'minus', '_': 'minus' };
const SHIFTED_PUNCTUATION = new Set(['>', '<', '+', '_']);
/**
 * The punctuation a shortcut chord names, from the character the layout
 * types for it: `{ token, shifted }` for a period, comma, equals or minus,
 * null for anything else. A letter is never punctuation, whatever key it
 * sits on (Dvorak types V on the period key, so Cmd+V must stay a paste);
 * the physical key decides only when the chord types nothing printable.
 */
export function shortcutPunctuation(e) {
  const key = String(e.key || '');
  if (/^[a-z]$/i.test(key)) return null;
  if (key.length === 1) {
    const token = PUNCTUATION[key];
    // The shifted forms are the characters themselves: a layout that needs Shift for "." still means Cmd+.
    if (token) return { token, shifted: SHIFTED_PUNCTUATION.has(key) };
    // Shift+period types ":" on German, Spanish, Italian and Nordic layouts: the physical key still names the chord.
    if (e.shiftKey && !/\p{L}/u.test(key)) { const physical = { Period: 'period', Comma: 'comma', Equal: 'equal', Minus: 'minus' }[e.code]; return physical ? { token: physical, shifted: true } : null; }
    return null;
  }
  const token = { Period: 'period', Comma: 'comma', Equal: 'equal', Minus: 'minus' }[e.code];
  return token ? { token, shifted: !!e.shiftKey } : null;
}

/** What to tell the user when a character could not be typed in: a fresh document has no caret until it is clicked. */
export function insertionMessage(code) {
  return code === 'editing-selection-required' ? 'Click in the document where the text should go first' : 'Could not insert here';
}

export function printShell(title, bodyHtml, { pageWidthIn = 8.5, pageHeightIn = 11 } = {}) {
  // The sheet is the document's own page; an unreadable size falls back to Letter.
  const inches = (value, fallback) => (Number.isFinite(value) && value >= 1 && value <= 200 ? Math.round(value * 100) / 100 : fallback);
  const width = inches(pageWidthIn, 8.5), height = inches(pageHeightIn, 11);
  // The published page's address is its only protection, and a browser would
  // otherwise send it along as the referrer of every link and web picture.
  // The page carries text, inline styles, and embedded or web pictures, and
  // nothing else may run in it: the print window shares the app's origin.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>
    /* The engine writes no direction on a right-to-left paragraph: each block reads its own from its first strong character. */
    p, li, td, th, h1, h2, h3, h4, h5, h6 { unicode-bidi: plaintext; }
@page { size: ${width}in ${height}in; margin: 1in; }
html, body { margin: 0; background: #fff; color: #000; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; line-height: 1.35; max-width: ${Math.max(2, Math.round((width - 2) * 100) / 100)}in; margin: 0 auto; padding: 0.5in 20px; overflow-wrap: break-word; }
@media print { body { padding: 0.5in 0; } }
p { margin: 0 0 8pt; }
h1, h2, h3, h4 { margin: 14pt 0 6pt; line-height: 1.2; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
td, th { border: 1px solid #000; padding: 3pt 5pt; vertical-align: top; }
img { max-width: 100%; height: auto; }
a { color: #0563c1; }
sup.note-ref { line-height: 0; }
sup.note-ref a, .footnote .note-number { text-decoration: none; }
.footnotes { margin-top: 18pt; font-size: 10pt; }
.footnotes hr { width: 2in; margin: 0 0 6pt; border: 0; border-top: 1px solid #000; }
.footnote p { margin: 0 0 4pt; }
.page-break { display: block; break-before: page; }
</style></head><body>${bodyHtml}</body></html>`;
}

/** Formats the document can be downloaded as, besides the .docx it is. */
export const EXPORT_FORMATS = [
  { id: 'html', label: 'Web page (.html)', ext: 'html', mime: 'text/html' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown' },
  { id: 'txt', label: 'Plain text (.txt)', ext: 'txt', mime: 'text/plain' },
];

/**
 * Render the document in a text format through the engine's projections.
 * HTML gets the same standalone shell as printing so it opens as a page.
 */
export async function exportText(api, format, title, page = {}) {
  const { hiddenRuns, withoutHidden } = await import('../lib/export-hidden.js');
  // Hidden runs and notes are read apart from the body projection; an edit in between would misplace them.
  const revision = api.info && (api.footnotes?.list || api.export?.toDocx) ? String((await api.info({})).revision) : null;
  const unchanged = async () => revision === null || String((await api.info({})).revision) === revision;
  // Hidden text is cut from every projection the export takes: the body, a link's scope, a note's story.
  const view = withoutHidden(api, await hiddenRuns(api));
  if (format.id === 'txt') {
    // Each note reference is its number in brackets, and the notes follow the text.
    const text = await readDocumentText(view, { notes: true });
    if (typeof text !== 'string') throw new Error('No content');
    if (!await unchanged()) throw new Error('The document changed while exporting. Try again');
    return text;
  }
  const { projectWithImages } = await import('../lib/export-images.js');
  const { appendNotes } = await import('../lib/export-notes.js');
  let content = await projectWithImages(view, format.id);
  if (typeof content !== 'string') throw new Error('No content');
  // A page break in a paragraph is projected as a placeholder: the page breaks there, Markdown starts a new paragraph.
  content = content.replace(/<span data-document-placeholder="page-break">\[page break\]<\/span>/g, format.id === 'html' ? '<span class="page-break" aria-hidden="true"></span>' : '\n\n');
  // Headings numbered through a list are projected as list items; they become headings again, numbers kept.
  if (format.id === 'html') content = (await import('../lib/export-headings.js')).liftNumberedHeadings(content);
  // Lists become Markdown lines before the notes are numbered, so a reference inside an item is not escaped as text.
  if (format.id === 'md') content = (await import('../lib/export-markdown-lists.js')).markdownLists(content);
  content = await appendNotes(view, format.id, content);
  if (!await unchanged()) throw new Error('The document changed while exporting. Try again');
  if (format.id === 'md') return content;
  return printShell(title, content, page);
}

/**
 * Paragraph spacing from dialog values (points or a line multiplier) to the
 * OOXML units the Document API takes: twentieths of a point, and 240ths of a
 * line. Returns null when a value is not a usable number.
 */
export function spacingToOoxml({ before, after, line, lineRule = 'auto' }) {
  // A value left blank is not written: the paragraph keeps what its style says for it.
  const blank = (v) => v === '' || v == null || (typeof v === 'number' && Number.isNaN(v));
  const pt = (v) => { const n = Number.parseFloat(String(v)); return Number.isFinite(n) && n >= 0 && n <= 500 ? Math.round(n * 20) : null; };
  if (!['auto', 'exact', 'atLeast'].includes(lineRule)) return null;
  const out = {};
  for (const [key, value] of [['before', before], ['after', after]]) {
    if (blank(value)) continue;
    const n = pt(value);
    if (n == null) return null;
    out[key] = n;
  }
  if (!blank(line)) {
    const multiple = lineRule === 'auto';
    const l = Number.parseFloat(String(line));
    if (!Number.isFinite(l) || l < (multiple ? 0.5 : 0.05) || l > (multiple ? 10 : 500)) return null;
    out.line = Math.round(l * (multiple ? 240 : 20));
    out.lineRule = lineRule;
  }
  return out;
}

/** The same paragraph settings, key for key: nothing to write. */
const sameSettings = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Placeholder of a field whose value the paragraph takes from its style. */
const FROM_STYLE = 'From style';

/** Put text on the clipboard; resolves whether it worked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}

/** Fit an image into the page column, keeping its aspect ratio. */
export function fitImage(width, height, max = MAX_IMAGE_WIDTH) {
  if (!width || !height) return null;
  if (width <= max) return { width: Math.round(width), height: Math.round(height), unit: 'px' };
  const scale = max / width;
  return { width: Math.round(max), height: Math.round(height * scale), unit: 'px' };
}

