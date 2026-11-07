/**
 * Page numbers in the header or footer, as real PAGE / NUMPAGES fields so
 * the engine (and other DOCX readers) keep them current. Each section's default header or
 * footer gets one paragraph with the fields, aligned as asked; sections that
 * share a header/footer part are handled once.
 */

export const PAGE_NUMBER_STYLES = [
  { id: 'number', label: '1, 2, 3' },
  { id: 'pageOfTotal', label: 'Page 1 of 3' },
];

/** The text to seed a paragraph with and the fields to drop into it (later offsets first). */
export function pageNumberText(style) {
  if (style === 'pageOfTotal') return { text: 'Page  of ', fields: [{ offset: 9, instruction: 'NUMPAGES' }, { offset: 5, instruction: 'PAGE' }] };
  return { text: '', fields: [{ offset: 0, instruction: 'PAGE' }] };
}

/** How page numbers are written, in menu order; the OOXML format names the engine takes. */
export const PAGE_NUMBER_FORMATS = [
  { id: 'decimal', label: '1, 2, 3' },
  { id: 'lowerRoman', label: 'i, ii, iii' },
  { id: 'upperRoman', label: 'I, II, III' },
  { id: 'lowerLetter', label: 'a, b, c' },
  { id: 'upperLetter', label: 'A, B, C' },
];

/** The numbering the document starts with, read from its first section. */
export function currentNumbering(sections) {
  const pn = sections?.[0]?.pageNumbering || {};
  const start = Number.isInteger(pn.start) && pn.start >= 1 ? pn.start : 1;
  const format = PAGE_NUMBER_FORMATS.some((f) => f.id === pn.format) ? pn.format : 'decimal';
  return { start, format };
}

/** A whole number from 1 to 32767 for "start at", or null; the engine refuses a start of 0. */
export function parseStartAt(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 32767 && String(value).trim() === String(n) ? n : null;
}

export function headerFooterStory(section, kind, variant = 'default') {
  return { kind: 'story', storyType: 'headerFooterSlot', section, headerFooterKind: kind, variant, resolution: 'effective', onWrite: 'materializeIfInherited' };
}

// The engine refuses a write that would change nothing (aligning a paragraph
// the way it already is): that is not a failure, and nothing to save either.
const noOp = (r) => r?.success === false && r?.failure?.code === 'NO_OP';
const ok = (r, what) => {
  if (r == null || (r.success === false && !noOp(r))) throw new Error(r?.failure?.message || `${what} failed`);
  return r;
};

// A dialog can close during a read or a previous write. Check immediately
// before each mutation and report accepted writes even if later work stops.
const write = async (operation, label, { beforeWrite = () => {}, onChange = () => {} }) => {
  beforeWrite();
  const result = ok(await operation(), label);
  if (!noOp(result)) onChange();
  return result;
};

/**
 * insertPageNumbers(api, { position: 'header' | 'footer', alignment, style, skipFirst })
 * Resolves the number of header/footer parts written. Every header or footer
 * a page can show gets the numbers: the even pages' when the document gives
 * them their own, and the first page's when it has one of its own and is
 * not meant to stay unnumbered.
 */
export async function insertPageNumbers(api, { position = 'footer', alignment = 'center', style = 'number', skipFirst = false } = {}, options = {}) {
  const sections = (await api.sections.list())?.items || [];
  if (!sections.length) throw new Error('The document has no sections');
  const listSlots = async () => (await api.headerFooters.list())?.items || [];
  let refs = await listSlots();
  const seen = new Set();
  let written = 0;
  // Paragraphs that already carry a page number field, wherever they are: a header or footer that has its
  // numbers is left as it is instead of getting a second set. The field list is not scoped to a story.
  const numbered = new Set();
  try {
    for (const field of (await api.fields?.list?.())?.items || []) {
      const instruction = String(field.instruction ?? field.instr ?? field.fieldType ?? '');
      if (/^\s*(?:PAGE|NUMPAGES)\b/i.test(instruction) && field.address?.blockId) numbered.add(field.address.blockId);
    }
  } catch { /* without a field list every slot is written, as before */ }
  const evenPages = oddEvenDifferent(sections);
  const slots = sections.flatMap((s) => ['default', ...(evenPages ? ['even'] : []), ...(s.titlePage && !skipFirst ? ['first'] : [])].map((variant) => ({ s, variant })));
  for (const { s, variant } of slots) {
    const section = s.address || { kind: 'section', sectionId: s.id };
    const slotOf = (items) => items.find((i) => (i.section?.sectionId ?? i.sectionId) === section.sectionId && i.kind === position && (i.variant || 'default') === variant);
    // A section without a header of its own shows the previous section's
    // ("link to previous"); its slot lists no part, so ask which part
    // it shows, or the shared part gets a second set of numbers.
    let refId = slotOf(refs)?.refId || null;
    if (!refId && api.headerFooters.resolve) {
      const resolved = await api.headerFooters.resolve({ target: { kind: 'headerFooterSlot', section, headerFooterKind: position, variant } });
      if (resolved?.status && resolved.status !== 'none' && resolved.refId) refId = resolved.refId;
    }
    if (refId) {
      if (seen.has(refId)) continue;
      seen.add(refId);
    }
    const story = headerFooterStory(section, position, variant);
    const blocks = (await api.blocks.list({ in: story }))?.blocks || [];
    if (blocks.some((block) => numbered.has(block.nodeId))) { if (refId) seen.add(refId); continue; }
    const { text, fields } = pageNumberText(style);
    let nodeId;
    if (blocks.length === 1 && blocks[0].isEmpty) {
      // A fresh header or footer starts with one empty paragraph: use it.
      nodeId = blocks[0].nodeId;
      if (text) {
        const pt = { kind: 'text', blockId: nodeId, offset: 0, story };
        await write(() => api.insert({ target: { kind: 'selection', start: pt, end: pt, story }, value: text }), 'Insert', options);
      }
    } else {
      const created = await write(() => api.create.paragraph({ in: story, text }), 'Create paragraph', options);
      nodeId = created.paragraph?.nodeId;
      if (!nodeId) throw new Error('Could not add a paragraph');
    }
    for (const f of fields) {
      await write(() => api.fields.insert({
        at: { kind: 'text', segments: [{ blockId: nodeId, range: { start: f.offset, end: f.offset } }], story },
        instruction: f.instruction, mode: 'raw', cachedResultText: '1',
      }), 'Field', options);
    }
    await write(() => api.format.paragraph.setAlignment({ target: { kind: 'block', nodeType: 'paragraph', nodeId, story }, alignment }), 'Alignment', options);
    written += 1;
    // Writing into a header the document did not have yet creates the part
    // and points every section that showed it at that part. Learn its id so
    // those sections are skipped instead of numbered a second time.
    refs = await listSlots();
    const created = slotOf(refs)?.refId;
    if (created) seen.add(created);
  }
  return written;
}

/**
 * Whether the first page has its own header and footer ("different
 * first page", `w:titlePg`), read from the first section.
 */
export function firstPageDifferent(sections) {
  return !!sections?.[0]?.titlePage;
}

/**
 * Give the first page its own header and footer (or share the others' again).
 * The first page's parts start out empty, which is how a title page goes
 * without a page number.
 */
/** Whether odd and even pages have their own headers and footers (a document-wide setting, "different odd and even pages"). */
export function oddEvenDifferent(sections) {
  return !!(sections || []).some((s) => s?.oddEvenHeadersFooters);
}

/** Give even pages their own header and footer, or share the odd pages' again. */
export async function setOddEvenDifferent(api, enabled, options = {}) {
  await write(() => api.sections.setOddEvenHeadersFooters({ enabled: !!enabled }), 'Odd and even pages', options);
  return !!enabled;
}

export async function setFirstPageDifferent(api, enabled, options = {}) {
  const sections = (await api.sections.list())?.items || [];
  const first = sections[0];
  if (!first) throw new Error('The document has no sections');
  const target = first.address || { kind: 'section', sectionId: first.id };
  await write(() => api.sections.setTitlePage({ target, enabled: !!enabled }), 'First page', options);
  return !!enabled;
}

/**
 * Set the number format and the first page's number on the document's first
 * section; later sections continue the count unless they restart it.
 */
export async function setPageNumbering(api, { start = 1, format = 'decimal' } = {}, options = {}) {
  const sections = (await api.sections.list())?.items || [];
  const first = sections[0];
  if (!first) throw new Error('The document has no sections');
  if (!PAGE_NUMBER_FORMATS.some((f) => f.id === format)) throw new Error('Unknown number format');
  const target = first.address || { kind: 'section', sectionId: first.id };
  await write(() => api.sections.setPageNumbering({ target, start, format }), 'Page numbering', options);
  return { start, format };
}
