import { MAX_TEXT } from './cell.js';
import { normalizeFontColor } from './font-color.js';
import { fontKeyFor, fontStack } from './format.js';

// Run styles describe character formatting only. Cell layout and number formats
// belong to the cell, never to a substring of its value.
export const RICH_FONT_KEYS = ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'color',
  'vertAlign', 'outline', 'shadow', 'condense', 'extend', 'family', 'charset', 'scheme'];
const FLAGS = ['bold', 'italic', 'strike', 'outline', 'shadow', 'condense', 'extend'];

export function richFontStyle(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of FLAGS) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  if (typeof raw.underline === 'boolean' || ['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'].includes(raw.underline)) out.underline = raw.underline;
  if (['baseline', 'superscript', 'subscript'].includes(raw.vertAlign)) out.vertAlign = raw.vertAlign;
  const font = typeof raw.font === 'string' && fontKeyFor(fontStack(raw.font, { fallbacks: false }));
  if (font) out.font = font;
  if (Number.isFinite(raw.size) && raw.size > 0 && raw.size <= 409 * 4 / 3) out.size = raw.size;
  const color = normalizeFontColor(raw.color);
  if (color) out.color = color;
  for (const [key, max] of [['family', 5], ['charset', 255]]) if (Number.isInteger(raw[key]) && raw[key] >= 0 && raw[key] <= max) out[key] = raw[key];
  if (['major', 'minor', 'none'].includes(raw.scheme)) out.scheme = raw.scheme;
  return out;
}

/** Validate runs against the actual text, clone them, and coalesce neighbours.
 * An optional end retains only a prefix after validating the entire original
 * value. Storage boundaries limit text; cloning must preserve the formats until
 * that boundary can trim text and formatting together and report the cut. */
export function normalizeRichText(raw, value, end = value?.length) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_TEXT || typeof value !== 'string') return null;
  const out = [];
  let offset = 0;
  for (const run of raw) {
    if (!run || typeof run.text !== 'string') return null;
    if (!value.startsWith(run.text, offset) || offset + run.text.length > value.length) return null;
    const text = run.text.slice(0, Math.max(0, end - offset));
    offset += run.text.length;
    if (!text) continue;
    const s = richFontStyle(run.s), last = out.at(-1);
    if (last && JSON.stringify(last.s || {}) === JSON.stringify(s)) last.text += text;
    else out.push({ text, ...(Object.keys(s).length ? { s } : {}) });
  }
  return offset === value.length && out.some(run => run.s) ? out : null;
}

export function richTextValue(runs) { return Array.isArray(runs) ? runs.map(run => typeof run?.text === 'string' ? run.text : '').join('') : ''; }

/** Slice by UTF-16 offsets, matching DOM input selections and string edits. */
export function sliceRichText(runs, start, end) {
  const out = [];
  let offset = 0;
  for (const run of runs || []) {
    const to = offset + run.text.length;
    if (to > start && offset < end) out.push({ text: run.text.slice(Math.max(0, start - offset), Math.min(run.text.length, end - offset)), s: run.s });
    offset = to;
    if (offset >= end) break;
  }
  return out;
}

/** Preserve unaffected character formats during an in-place text edit.
 * Newly inserted text inherits the character immediately before the caret,
 * or the first character's style when insertion is at the beginning. */
export function editRichText(runs, before, after) {
  if (typeof before !== 'string' || typeof after !== 'string' || !normalizeRichText(runs, before)) return null;
  let start = 0, suffix = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  // Do not split a Unicode character at the edit boundary.
  if (start && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(before[before.length - suffix])) suffix--;
  const inserted = after.slice(start, after.length - suffix);
  const style = sliceRichText(runs, Math.max(0, start - 1), Math.max(1, start))[0]?.s;
  return normalizeRichText([...sliceRichText(runs, 0, start), ...(inserted ? [{ text: inserted, s: style }] : []),
    ...sliceRichText(runs, before.length - suffix, before.length)], after);
}

/** Cell-wide font edits replace the corresponding per-character overrides. */
export function patchRichText(runs, value, patch) {
  if (!runs) return null;
  const keys = RICH_FONT_KEYS.filter(key => Object.hasOwn(patch, key) || key === 'scheme' && Object.hasOwn(patch, 'font'));
  if (!keys.length) return runs;
  return normalizeRichText(runs.map(run => {
    const s = { ...run.s };
    for (const key of keys) delete s[key];
    return { text: run.text, s };
  }), value);
}
