import { unzipSync, strFromU8 } from 'fflate';
import { bytesFromBase64 } from './bytes.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const MAIN = 'main:/word/document.xml';

/** Deleted fields remain in hyperlink discovery but have no visible selection. */
export async function deletedFieldLinks(api, projection, fieldIds, listFields = query => api.fields.list(query)) {
  const omitted = new Set();
  if (!fieldIds.size || !api.trackChanges?.list || !api.fields?.list) return omitted;
  let offset = 0, deleted = false;
  while (true) {
    const result = await api.trackChanges.list({ limit: 1000, offset });
    const items = result.items || [];
    deleted = items.some(item => item.subtype === 'field-deletion' && item.navigationTarget?.story?.storyType === 'body');
    offset += items.length;
    if (deleted || !items.length || offset >= result.total) break;
  }
  if (!deleted) return omitted;
  // Default export retains review markup. Final export has already removed the
  // fields and shifted their per-paragraph occurrence indexes.
  const exported = await api.export.toDocx({});
  // Only the body is read; the rest of the package (media above all) is not inflated for it.
  const files = unzipSync(bytesFromBase64(exported.contentBase64), { filter: (file) => file.name === 'word/document.xml' });
  const document = new DOMParser().parseFromString(strFromU8(files['word/document.xml']), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Could not read the document fields');
  const counts = new Map(), removed = new Set();
  for (const node of document.getElementsByTagNameNS(W, '*')) {
    if (node.localName !== 'fldSimple' && !(node.localName === 'fldChar' && node.getAttributeNS(W, 'fldCharType') === 'begin')) continue;
    let paragraph = null, deleted = false, textBox = false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.namespaceURI !== W) continue;
      if (parent.localName === 'p' && !paragraph) paragraph = parent;
      if (parent.localName === 'del' || parent.localName === 'moveFrom') deleted = true;
      if (parent.localName === 'txbxContent') textBox = true;
    }
    const blockId = paragraph?.getAttributeNS(W14, 'paraId');
    if (!blockId || textBox) continue;
    const occurrence = counts.get(blockId) || 0;
    counts.set(blockId, occurrence + 1);
    if (deleted) removed.add(`${blockId}:${occurrence}`);
  }
  offset = 0;
  while (true) {
    const result = await listFields({ limit: 1000, offset });
    const items = result.items || [];
    for (const field of items) {
      const address = field.address;
      if (address?.storyId !== MAIN || !removed.has(`${address.blockId}:${address.occurrenceIndex}`)) continue;
      const id = `hl-field:${address.fieldId || field.id}`;
      if (fieldIds.has(id)) omitted.add(id);
    }
    offset += items.length;
    if (!items.length || offset >= result.total) break;
  }
  if (api.info && String((await api.info({})).revision) !== String(projection.evaluatedRevision)) throw new Error('The document changed while exporting. Try again');
  return omitted;
}
