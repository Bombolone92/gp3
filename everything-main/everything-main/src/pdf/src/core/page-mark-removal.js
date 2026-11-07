import { PDFArray, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { tokenize } from './content-filter.js';

/**
 * Remove headers, footers, page numbers, Bates numbers, and watermarks: the pagination
 * artifacts (`/Artifact <</Type /Pagination /Subtype /Header>> BDC … EMC`) that this app
 * writes and that other editors tag the same way. Everything else on the page is kept
 * byte for byte. `kinds` picks the subtypes; returns how many marks were removed.
 */
export const PAGE_MARK_KINDS = ['Header', 'Footer', 'Watermark'];

const latin1 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
};
const bytesOf = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** The Type and Subtype a BDC's inline property list names. */
function paginationKind(command) {
  const [tag, properties] = command.args || [];
  if (tag?.type !== 'name' || tag.value !== 'Artifact' || properties?.type !== 'dict') return null;
  const entries = {};
  for (let i = 0; i + 1 < properties.value.length; i += 2)
    entries[properties.value[i].value] = properties.value[i + 1].value;
  return entries.Type === 'Pagination' ? entries.Subtype || null : null;
}

/** The source with every matching artifact section cut out, and how many were cut. */
export function stripPaginationArtifacts(source, kinds = PAGE_MARK_KINDS) {
  const commands = tokenize(source);
  const cuts = [];
  for (let i = 0; i < commands.length; i++) {
    if (commands[i].op !== 'BDC' || !kinds.includes(paginationKind(commands[i]))) continue;
    let depth = 0,
      end = -1;
    for (let k = i; k < commands.length; k++) {
      const op = commands[k].op;
      if (op === 'BDC' || op === 'BMC') depth++;
      else if (op === 'EMC' && --depth === 0) {
        end = k;
        break;
      }
    }
    if (end === -1) continue; // an unbalanced section is left alone
    // The section starts at its tag's operands, which precede the BDC operator.
    cuts.push([commands[i].start, commands[end].end]);
    i = end;
  }
  if (!cuts.length) return { source, removed: 0 };
  let out = '',
    at = 0;
  for (const [start, end] of cuts) {
    out += source.slice(at, start);
    at = end;
  }
  return { source: out + source.slice(at), removed: cuts.length };
}

export function removePageMarks(doc, indices = doc.getPageIndices(), kinds = PAGE_MARK_KINDS) {
  const CONTENTS = PDFName.of('Contents');
  let removed = 0;
  for (const index of indices) {
    const node = doc.getPage(index).node;
    const contents = node.get(CONTENTS);
    const array = doc.context.lookup(contents);
    const refs = array instanceof PDFArray ? array.asArray() : contents ? [contents] : [];
    refs.forEach((ref, k) => {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFStream)) return;
      let bytes;
      try {
        bytes =
          stream instanceof PDFRawStream
            ? decodePDFRawStream(stream).decode()
            : stream.getContents();
      } catch {
        return; // an undecodable stream is left as it is
      }
      const result = stripPaginationArtifacts(latin1(bytes), kinds);
      if (!result.removed) return;
      removed += result.removed;
      // A stream shared with another page is replaced on this page only.
      const replacement = doc.context.register(doc.context.flateStream(bytesOf(result.source)));
      if (array instanceof PDFArray) array.set(k, replacement);
      else node.set(CONTENTS, replacement);
    });
  }
  return removed;
}
