/**
 * Paragraph indentation: left and right edges, plus a first-line or hanging
 * indent. The Document API reads the values back in points and takes them
 * in twentieths of a point; the dialog shows inches or centimeters to match
 * the measurement unit the page setup uses.
 */

import { paragraphTarget } from './paragraphs.js';

const PT_PER_IN = 72;
const PT_PER_CM = 72 / 2.54;
const MAX_IN = 22;

/** Points -> a rounded value in the display unit. */
export function ptToUnit(pt, unit) {
  const n = Number(pt) || 0;
  const v = unit === 'cm' ? n / PT_PER_CM : n / PT_PER_IN;
  return Math.round(v * 100) / 100;
}

/** Display unit -> twips (twentieths of a point), or null when not a number. */
export function unitToTwips(value, unit) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const pt = unit === 'cm' ? n * PT_PER_CM : n * PT_PER_IN;
  return Math.round(pt * 20);
}

/** Keep input values precise enough to round-trip DOCX twips. */
function inputUnit(pt, unit) {
  const n = Number(pt) || 0;
  const rounded = ptToUnit(n, unit);
  if (unitToTwips(rounded, unit) === Math.round(n * 20)) return rounded;
  const value = unit === 'cm' ? n / PT_PER_CM : n / PT_PER_IN;
  return Math.round(value * 10000) / 10000;
}

/**
 * The dialog's values for a paragraph's `indent` props (points): left,
 * right, and a "special" indent that is either first line or hanging. The
 * engine reports only what the paragraph sets itself; a value its style or
 * list supplies comes back as an empty string, and the special indent as
 * 'inherit', so the dialog can leave them alone.
 */
export function indentFromProps(indent, unit) {
  const i = indent || {};
  const hanging = Number(i.hanging) || 0;
  const firstLine = Number(i.firstLine) || 0;
  const setsSpecial = i.hanging != null || i.firstLine != null;
  return {
    left: i.left == null ? '' : inputUnit(i.left, unit),
    right: i.right == null ? '' : inputUnit(i.right, unit),
    special: hanging > 0 ? 'hanging' : firstLine > 0 ? 'firstLine' : setsSpecial ? 'none' : 'inherit',
    by: inputUnit(hanging > 0 ? hanging : firstLine, unit),
  };
}

const blank = (v) => v === '' || v == null || (typeof v === 'number' && Number.isNaN(v));

/**
 * Dialog values -> the setIndentation payload (twips). Returns null when a
 * value exceeds the supported distance. Left and right may be negative to
 * extend text into the margins; the special distance is non-negative. The engine takes
 * either `firstLine` or `hanging`, never both; a first line of zero is how
 * an existing hanging indent is cleared. A blank left or right and an
 * 'inherit' special indent are left out of the payload: the paragraph keeps
 * what its style or list says for them.
 */
export function indentToPayload({ left, right, special, by }, unit) {
  const max = MAX_IN * PT_PER_IN * 20;
  const out = {};
  for (const [key, value] of [['left', left], ['right', right]]) {
    if (blank(value)) continue;
    const twips = unitToTwips(value, unit);
    if (twips == null || Math.abs(twips) > max) return null;
    out[key] = twips;
  }
  if (special === 'inherit') return out;
  const b = special === 'none' ? 0 : unitToTwips(by, unit);
  if (b == null || b < 0 || b > max) return null;
  if (special === 'hanging' && b > 0) return { ...out, hanging: b };
  return { ...out, firstLine: special === 'firstLine' ? b : 0 };
}

/** Apply one payload to every paragraph; throws on the first failure. */
export async function applyIndent(api, nodeIds, payload, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  for (const nodeId of nodeIds) {
    beforeWrite();
    const r = await api.format.paragraph.setIndentation({ target: paragraphTarget(nodeId, story), ...payload });
    if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'Indentation was not applied');
    if (r.success !== false) onChange();
  }
  return nodeIds.length;
}
