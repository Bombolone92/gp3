/**
 * Turning stored answers back into words. Responses keep ids (choice ids,
 * row ids, field ids); people read labels. Questions and choices can be
 * edited or removed after responses arrive, so every lookup falls back to a
 * clear placeholder instead of an id.
 */
import { OTHER_ID, NONE_ID, CONTACT_FIELDS, fieldsOf, ratingMax } from '../shared/runtime.js';

export const REMOVED_CHOICE = '(removed choice)';
export const REMOVED_ROW = '(removed row)';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Label for a choice id of `q`, including Other / None of the above. */
export function choiceLabel(q, id) {
  if (id === OTHER_ID) return (q.other && q.other.label) || 'Other';
  if (id === NONE_ID) return (q.none && q.none.label) || 'None of the above';
  const c = (q.choices || []).find((x) => x.id === id);
  return c ? c.label || '(blank choice)' : REMOVED_CHOICE;
}

/** Label of a row, column or field by id: `fallback` once it is removed. */
export function listLabel(list, id, fallback) {
  const c = (list || []).find((x) => x.id === id);
  return c ? c.label || '(blank)' : fallback;
}

/**
 * Label for an answered field the question no longer shows: a contact
 * field turned off keeps its name; anything else was removed.
 */
export function hiddenFieldLabel(q, id) {
  const known = q.type === 'contact' && CONTACT_FIELDS.find(([fid]) => fid === id);
  if (!known) return '(removed field)';
  return (q.fields && q.fields[id] && q.fields[id].label) || known[1];
}

/** The ids a choice answer picked, as an array (single or multi). */
export function pickedIds(value) {
  if (!isObj(value)) return [];
  if (Array.isArray(value.c)) return value.c;
  return typeof value.c === 'string' ? [value.c] : [];
}

/** True when `value` is an answer at all (sanitized answers never store blanks). */
export function hasAnswer(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (isObj(value)) return Object.keys(value).length > 0;
  return true;
}

/**
 * Whether a stored answer has the shape `q`'s type stores. A question whose
 * type changed after responses arrived keeps its id, so older answers of
 * another shape (a choice under what is now a text question) can be there.
 */
export function fitsType(q, value) {
  switch (q.type) {
    case 'single':
    case 'dropdown':
    case 'multi':
      return isObj(value) && (typeof value.c === 'string' || Array.isArray(value.c));
    case 'rating':
    case 'nps':
    case 'slider':
      return (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value));
    // A grid answer names the grid's rows, or picks its columns (rows
    // removed since); boxes are keyed by their own ids. A choice answer
    // ({c}), or a grid answer under what are now text boxes, is from
    // another type.
    case 'matrix': {
      if (!isObj(value) || own(value, 'c')) return false;
      const cols = new Set((q.columns || []).map((c) => c.id));
      return (q.rows || []).some((r) => own(value, r.id)) || Object.values(value).flat().some((v) => cols.has(v));
    }
    case 'multitext':
      return isObj(value) && !own(value, 'c') && (q.fields || []).some((f) => own(value, f.id));
    case 'contact':
      return isObj(value) && !own(value, 'c') && CONTACT_FIELDS.some(([id]) => own(value, id));
    case 'ranking':
      return Array.isArray(value);
    case 'text':
    case 'textarea':
    case 'datetime':
      return typeof value === 'string' || typeof value === 'number';
    default:
      return true;
  }
}

/** An answer that does not fit its question's type, as plain text: choices
 *  picked and choices ranked by their labels where `q` still has them. */
function looseText(q, value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (isObj(value) && (typeof value.c === 'string' || Array.isArray(value.c))) {
    const picked = pickedIds(value).map((id) => choiceLabel(q, id));
    return [...picked, ...(typeof value.t === 'string' && value.t ? [value.t] : [])].join('; ');
  }
  if (Array.isArray(value) && value.every((id) => typeof id === 'string')) return value.map((id, i) => `${i + 1}. ${choiceLabel(q, id)}`).join('; ');
  return JSON.stringify(value);
}

function fmtDateValue(v) {
  // Stored as YYYY-MM-DD, HH:MM, or both joined by T. Shown in the
  // reader's locale, without shifting the date through a time zone.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
    return m[4]
      ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }
  return v;
}

/**
 * A readable answer. Returns an array of lines (most answers are one line;
 * grids, rankings and multi-field answers are several). Empty array when
 * unanswered.
 */
export function answerLines(q, value) {
  if (!hasAnswer(value)) return [];
  if (!fitsType(q, value)) return [looseText(q, value)];
  switch (q.type) {
    case 'single':
    case 'dropdown':
    case 'multi': {
      const ids = pickedIds(value);
      return ids.map((id) => (id === OTHER_ID && value.t ? `${choiceLabel(q, id)}: ${value.t}` : choiceLabel(q, id)));
    }
    case 'rating':
      return [`${value} of ${ratingMax(q)}`];
    case 'nps':
    case 'slider':
      return [String(value)];
    case 'matrix':
      if (!isObj(value)) return [];
      return Object.entries(value).map(([rowId, v]) => {
        const row = listLabel(q.rows, rowId, REMOVED_ROW);
        const cols = (Array.isArray(v) ? v : [v]).map((c) => listLabel(q.columns, c, REMOVED_CHOICE));
        return `${row}: ${cols.join(', ')}`;
      });
    case 'ranking':
      return Array.isArray(value) ? value.map((id, i) => `${i + 1}. ${choiceLabel(q, id)}`) : [];
    case 'multitext':
    case 'contact': {
      if (!isObj(value)) return [];
      const fields = fieldsOf(q);
      const known = new Set(fields.map((f) => f.id));
      const lines = fields.filter((f) => value[f.id]).map((f) => `${f.label}: ${value[f.id]}`);
      for (const [k, v] of Object.entries(value)) if (!known.has(k) && v) lines.push(`${hiddenFieldLabel(q, k)}: ${v}`);
      return lines;
    }
    case 'datetime':
      return [fmtDateValue(String(value))];
    case 'text':
    case 'textarea':
      return [String(value)];
    default:
      return [typeof value === 'string' ? value : JSON.stringify(value)];
  }
}

export const answerText = (q, value) => answerLines(q, value).join('\n');
