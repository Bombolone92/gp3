/**
 * A date that keeps itself current: a DATE field, which the engine (and other
 * DOCX readers) recompute when the document opens, seeded with today's text so
 * it reads right immediately. The format switch follows the user's locale.
 */

/** The date picture for a locale: "MMMM d, yyyy" in the US, "d MMMM yyyy" elsewhere. */
export function dateFieldFormat(locale = (typeof navigator !== 'undefined' ? navigator.language : 'en-US')) {
  return /^en-(US|PH)?$|^en$/i.test(String(locale || '')) ? 'MMMM d, yyyy' : 'd MMMM yyyy';
}

export function dateFieldInstruction(locale) {
  return `DATE \\@ "${dateFieldFormat(locale)}"`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The text the field shows for `date` in its picture, as the engine writes it
 * when it recomputes the field (English month names). Seeding the
 * field with the same text keeps the date from changing when the document is
 * opened again.
 */
export function dateFieldText(date = new Date(), locale) {
  const month = MONTHS[date.getMonth()], day = date.getDate(), year = date.getFullYear();
  return dateFieldFormat(locale) === 'MMMM d, yyyy' ? `${month} ${day}, ${year}` : `${day} ${month} ${year}`;
}

/** The collapsed text target at the start of a selection snapshot, or null. */
export function caretTarget(snap) {
  const start = snap?.selectionTarget?.start;
  if (!start?.blockId) return null;
  const story = start.story || snap.selectionTarget.story || snap.target?.story || { kind: 'story', storyType: 'body' };
  return { kind: 'text', segments: [{ blockId: start.blockId, range: { start: start.offset || 0, end: start.offset || 0 } }], story };
}

/** Whether a selection snapshot covers text rather than a single point. */
const hasRange = (snap) => {
  const { start, end } = snap?.selectionTarget || {};
  return !!(start && end && (start.blockId !== end.blockId || (start.offset || 0) !== (end.offset || 0)));
};

/** Insert the field at the caret with today's text as its cached result; selected text makes way for it, as for typing. */
export async function insertDateField(api, snap, text, { locale, onChange = () => {}, beforeWrite = () => {} } = {}) {
  const at = caretTarget(snap);
  if (!at) throw new Error('Place the cursor in the text first');
  if (hasRange(snap) && api.delete) {
    beforeWrite();
    const removed = await api.delete({ target: snap.selectionTarget });
    if (removed == null || removed.success === false) throw new Error(removed?.failure?.message || 'The selected text could not be replaced');
    onChange();
  }
  beforeWrite();
  const r = await api.fields.insert({ at, instruction: dateFieldInstruction(locale), mode: 'raw', cachedResultText: text });
  if (r == null || r.success === false) throw new Error(r?.failure?.message || 'The date was not inserted');
  onChange();
  return r;
}
