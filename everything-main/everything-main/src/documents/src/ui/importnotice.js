import { el } from './dom.js';

/** A persistent, expandable conversion report beside the document. */
export function importNotice(info) {
  if (!info) return null;
  const notes = info.warnings || [];
  return el('details.import-notice', {},
    el('summary', {}, `Hanword ${info.format} import · Editing a DOCX copy${notes.length ? ` · ${notes.length} conversion ${notes.length === 1 ? 'note' : 'notes'}` : ''}`),
    el('p', {}, `${info.sourceName} was converted to an editable document. Changes save as a new .docx file. The original Hanword file is unchanged. Fonts and pagination may differ from Hanword.`),
    notes.length ? el('ul', {}, ...notes.map((note) => el('li', {}, note))) : null);
}
