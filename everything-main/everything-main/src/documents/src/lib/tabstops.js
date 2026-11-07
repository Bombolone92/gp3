/**
 * Tab stops for the selected paragraphs: where a tab lands, how the text
 * lines up there (left, center, right, decimal, or a bar), and the leader
 * that fills the gap. The Document API sets and clears stops in twips but
 * does not read them back, so the current stops are read from the
 * paragraph's `w:tabs` in the document's own DOCX bytes; a paragraph's
 * block id is its `w14:paraId`.
 */

import { unitToTwips, ptToUnit } from './indent.js';
import { paragraphTarget } from './paragraphs.js';

export const TAB_ALIGNMENTS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
  { id: 'decimal', label: 'Decimal' },
  { id: 'bar', label: 'Bar' },
];

export const TAB_LEADERS = [
  { id: 'none', label: 'None', sample: '' },
  { id: 'dot', label: 'Dots', sample: '......' },
  { id: 'hyphen', label: 'Dashes', sample: '------' },
  { id: 'underscore', label: 'Line', sample: '______' },
];

const MAX_TWIPS = 22 * 1440;
/** The DOCX `w:val` for a stop -> the API's alignment ('start' and 'end' are the older spellings). */
const ALIGN_ALIASES = { start: 'left', end: 'right', num: 'decimal' };
const LEADER_ALIASES = { middleDot: 'dot', heavy: 'underscore' };

/** A typed position in the display unit -> twips, or null when it is not a usable distance. */
export function parseTabPosition(value, unit) {
  const twips = unitToTwips(value, unit);
  if (twips == null || twips <= 0 || twips > MAX_TWIPS) return null;
  return twips;
}

/** "2 in" or "5.08 cm" for a position in twips. */
export function formatTabPosition(twips, unit) {
  return `${ptToUnit(twips / 20, unit)} ${unit === 'cm' ? 'cm' : 'in'}`;
}

/** One line for the dialog's list: "2 in · Right · Dots". */
export function describeTabStop(stop, unit) {
  const align = TAB_ALIGNMENTS.find((a) => a.id === stop.alignment)?.label || 'Left';
  const leader = TAB_LEADERS.find((l) => l.id === stop.leader);
  return [formatTabPosition(stop.position, unit), align, leader && leader.id !== 'none' ? leader.label : null].filter(Boolean).join(' · ');
}

/**
 * The stops set on the paragraph with `paraId` in a document.xml string,
 * sorted by position. Cleared stops (`w:val="clear"`) are left out.
 */
export function parseTabStops(xml, paraId) {
  const current = paragraphPropertiesXml(xml, paraId);
  const tabs = current && /<w:tabs>([\s\S]*?)<\/w:tabs>/i.exec(current);
  if (!tabs) return [];
  return tabValues([...tabs[1].matchAll(/<w:tab\b([^>]*)\/?>/gi)].map((m) =>
    (name) => new RegExp(`\\bw:${name}="([^"]*)"`).exec(m[1])?.[1]));
}

/**
 * The current properties (the inside of `w:pPr`) of the paragraph with `paraId`
 * in a document.xml string; null when the paragraph or its properties are absent.
 */
export function paragraphPropertiesXml(xml, paraId) {
  if (typeof xml !== 'string' || !paraId) return null;
  const id = String(paraId).replace(/\W/g, '');
  if (!id) return null;
  const para = new RegExp(`<w:p\\b[^>]*\\bw14:paraId="${id}"[^>]*>([\\s\\S]*?)<\\/w:p>`, 'i').exec(xml);
  if (!para) return null;
  // Paragraph properties come first. Searching descendants can borrow a
  // text box's properties when its anchor paragraph has none of its own.
  const pPr = /^(?:\s|<!--[\s\S]*?-->|<\?[\s\S]*?\?>)*<w:pPr>([\s\S]*?)<\/w:pPr>/i.exec(para[1]);
  // pPrChange is the previous formatting, not the paragraph's current properties.
  return pPr ? pPr[1].split(/<w:pPrChange\b/i, 1)[0] : null;
}

function tabValues(attributes) {
  const stops = [];
  for (const attr of attributes) {
    const val = attr('val') || 'left';
    const pos = Number.parseInt(attr('pos') || '', 10);
    if (val === 'clear' || !Number.isFinite(pos) || pos <= 0) continue;
    const alignment = ALIGN_ALIASES[val] || val;
    const rawLeader = attr('leader') || 'none';
    stops.push({ position: pos, alignment: TAB_ALIGNMENTS.some((a) => a.id === alignment) ? alignment : 'left', leader: LEADER_ALIASES[rawLeader] || rawLeader });
  }
  return stops.sort((a, b) => a.position - b.position);
}

/**
 * Read one XML entry (stored or deflated). Resolves null when absent or
 * unreadable.
 */
async function readXmlEntry(bytes, path) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entry = locateEntry(bytes, dv, decoder, path);
  if (!entry) return null;
  if (entry.method === 0) return decoder.decode(entry.data);
  if (entry.method !== 8) return null;
  return new Response(new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}

/**
 * An entry's method and compressed bytes, by way of the central directory,
 * which knows every entry's size even when the writer streamed the data and
 * left the size for a descriptor after it (as the export normalizer does).
 * An archive without a directory is walked by its local headers instead.
 */
function locateEntry(bytes, dv, decoder, path) {
  // The end-of-central-directory record sits last, before a comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd >= 0) {
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < count && off + 46 <= bytes.length; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) return null;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));
      if (name === path) {
        // ZIP64 sizes and offsets are not expected in a document.
        if (csize === 0xffffffff || local === 0xffffffff) return null;
        if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) return null;
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        if (start + csize > bytes.length) return null;
        return { method, data: bytes.subarray(start, start + csize) };
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  }
  let off = 0;
  while (off + 30 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const flags = dv.getUint16(off + 6, true);
    const method = dv.getUint16(off + 8, true);
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = decoder.decode(bytes.subarray(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    // A data descriptor (bit 3) means the sizes come after the data; such entries cannot be walked past.
    if (flags & 0x8) return null;
    if (name === path) return { method, data: bytes.subarray(start, start + csize) };
    off = start + csize;
  }
  return null;
}

/** The main document XML of a DOCX Blob. */
export async function readDocumentXml(blob) {
  return readXmlEntry(new Uint8Array(await blob.arrayBuffer()), 'word/document.xml');
}

/** The document's default tab interval in twips: a half inch unless its settings say otherwise (some producers write 709 or 1251). */
export async function readDefaultTabStop(blob) {
  const xml = await readXmlEntry(new Uint8Array(await blob.arrayBuffer()), 'word/settings.xml');
  const value = Number(/<(?:[\w.-]+:)?defaultTabStop\b[^>]*\bw:val="(\d+)"/.exec(xml || '')?.[1]);
  return value > 0 && value <= 31680 ? value : 720;
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const child = (node, name) => [...(node?.children || [])].find((c) => c.namespaceURI === WORD_NS && c.localName === name);

/** The paragraph with `paraId` in the selected header/footer or note, resolved through the document's relationships; null when not found. */
async function storyParagraph(bytes, paraId, story) {
  const parser = new DOMParser();
  const rels = parser.parseFromString(await readXmlEntry(bytes, 'word/_rels/document.xml.rels') || '', 'application/xml');
  const isNote = story.storyType === 'footnote' || story.storyType === 'endnote';
  if (!isNote && story.storyType !== 'headerFooterPart') return null;
  const rel = [...rels.getElementsByTagNameNS(REL_NS, 'Relationship')].find((r) =>
    r.getAttribute('TargetMode') !== 'External' && (isNote
      ? r.getAttribute('Type')?.endsWith(`/${story.storyType}s`)
      : r.getAttribute('Id') === story.refId));
  const target = rel?.getAttribute('Target');
  if (!target) return null;
  const path = new URL(target, 'https://docx.invalid/word/document.xml');
  if (path.origin !== 'https://docx.invalid') return null;
  const xml = await readXmlEntry(bytes, decodeURIComponent(path.pathname.slice(1)));
  if (!xml) return null;
  const part = parser.parseFromString(xml, 'application/xml');
  const scope = isNote ? [...part.getElementsByTagNameNS(WORD_NS, story.storyType)]
    .find((n) => n.getAttributeNS(WORD_NS, 'id') === String(story.noteId)) : part.documentElement;
  return [...(scope?.getElementsByTagNameNS(WORD_NS, 'p') || [])]
    .find((p) => p.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId')?.toLowerCase() === String(paraId).toLowerCase()) || null;
}

async function readStoryTabStops(blob, paraId, story) {
  const paragraph = await storyParagraph(new Uint8Array(await blob.arrayBuffer()), paraId, story);
  const tabs = child(child(paragraph, 'pPr'), 'tabs');
  return tabValues([...(tabs?.getElementsByTagNameNS(WORD_NS, 'tab') || [])].map((tab) => (name) => tab.getAttributeNS(WORD_NS, name)));
}

/**
 * The current properties of a paragraph (the inside of its `w:pPr`, as XML text)
 * read from the document's bytes, in the body or in the story given; null when
 * the paragraph has none or cannot be read.
 */
export async function readParagraphProperties(blob, paraId, { story } = {}) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!story || story.storyType === 'body') return paragraphPropertiesXml(await readXmlEntry(bytes, 'word/document.xml'), paraId);
    const pPr = child(await storyParagraph(bytes, paraId, story), 'pPr');
    if (!pPr) return null;
    const current = pPr.cloneNode(true);
    for (const change of [...current.children]) if (change.namespaceURI === WORD_NS && change.localName === 'pPrChange') change.remove();
    return new XMLSerializer().serializeToString(current);
  } catch { return null; }
}

/** The current stops of a paragraph, read from the document's bytes ([] when they cannot be read). */
export async function readTabStops(blob, paraId, { story } = {}) {
  try {
    if (story && story.storyType !== 'body') return await readStoryTabStops(blob, paraId, story);
    return parseTabStops(await readDocumentXml(blob), paraId);
  } catch {
    return [];
  }
}

const ok = (r, onChange) => {
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'Tab stop was not applied');
  if (r.success !== false) onChange();
};

/** Set one stop on every paragraph; onApplied also reports an accepted NO_OP. */
export async function addTabStop(api, nodeIds, { position, alignment, leader = 'none' }, { story, beforeWrite = () => {}, onChange = () => {}, onApplied = () => {} } = {}) {
  for (const nodeId of nodeIds) {
    const input = { target: paragraphTarget(nodeId, story), position, alignment };
    if (leader && leader !== 'none') input.leader = leader;
    beforeWrite();
    ok(await api.format.paragraph.setTabStop(input), onChange);
    onApplied(nodeId);
  }
  return nodeIds.length;
}

/** Remove the stop at `position` (twips) from every paragraph. */
export async function removeTabStop(api, nodeIds, position, { story, beforeWrite = () => {}, onChange = () => {}, onApplied = () => {} } = {}) {
  for (const nodeId of nodeIds) {
    beforeWrite();
    ok(await api.format.paragraph.clearTabStop({ target: paragraphTarget(nodeId, story), position }), onChange);
    onApplied(nodeId);
  }
  return nodeIds.length;
}

/** Remove every stop from every paragraph. */
export async function clearTabStops(api, nodeIds, { story, beforeWrite = () => {}, onChange = () => {}, onApplied = () => {} } = {}) {
  for (const nodeId of nodeIds) {
    beforeWrite();
    ok(await api.format.paragraph.clearAllTabStops({ target: paragraphTarget(nodeId, story) }), onChange);
    onApplied(nodeId);
  }
  return nodeIds.length;
}
