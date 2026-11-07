/** Block boundaries that the engine's HTML projection keeps but getText omits. */
const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'HR']);
const OMIT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'IFRAME', 'OBJECT', 'EMBED']);

const NOTE_REFERENCE = /^\[(footnote|endnote) ([^\]]+)\]$/;

function childrenText(node, refs = null) {
  const parts = [...node.childNodes].map((child) => render(child, refs)).filter(Boolean);
  return parts.map((part, i) => `${i && (part.block || parts[i - 1].block) ? '\n' : ''}${part.text}`).join('');
}

function render(node, refs) {
  if (node.nodeType === 3) return node.nodeValue ? { text: node.nodeValue, block: false } : null;
  if (node.nodeType !== 1 || OMIT.has(node.tagName)) return null;
  // The engine projects pictures, and links it cannot resolve (a telephone
  // number, a place in the document), as diagnostic spans: "[image]",
  // "[link unavailable]". Plain-text exports and speech omit these; the
  // link's own text stays.
  if (node.hasAttribute('data-document-placeholder')) {
    // A page break in a paragraph ends the line: the words on either side are not one word.
    if (node.getAttribute('data-document-placeholder') === 'page-break') return { text: '\n', block: false };
    // A cell whose table inside could not be projected keeps the engine's note, not a silent blank.
    if (node.getAttribute('data-document-placeholder') === 'unsupportedTable') return { text: node.textContent, block: true };
    // A note reference becomes its number in brackets when the notes go out with the text.
    const reference = refs && node.getAttribute('data-document-placeholder') === 'note' && NOTE_REFERENCE.exec(node.textContent);
    if (!reference) return null;
    refs.push({ type: reference[1], number: reference[2] });
    return { text: `[${reference[2]}]`, block: false };
  }
  if (node.tagName === 'BR') return { text: '\n', block: false };
  const text = node.tagName === 'TR'
    ? [...node.children].filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH').map((cell) => childrenText(cell, refs)).join('\t')
    : childrenText(node, refs);
  const block = BLOCKS.has(node.tagName);
  return text || block ? { text, block } : null;
}

/**
 * The document's HTML without its hidden text, which is neither shown nor
 * printed: the projection carries a source map the hidden runs are cut through.
 */
async function visibleHtml(api) {
  const { hiddenRuns, omitHidden } = await import('./export-hidden.js');
  // A view whose projections already leave the hidden text out.
  if (api.hiddenRunsApplied) {
    const projection = await api.projectHtml({});
    return projection?.status === 'failed' || typeof projection?.content !== 'string' ? null : projection.content;
  }
  const runs = await hiddenRuns(api);
  // Nothing hidden: the plain HTML read is enough, and cheaper than a projection with a source map.
  if (!runs.length) return null;
  const projection = await api.projectHtml({ includeSourceMap: true });
  if (projection?.status === 'failed' || typeof projection?.content !== 'string') return null;
  if (api.info && String((await api.info({})).revision) !== String(projection.evaluatedRevision)) throw new Error('The document changed while exporting. Try again');
  return omitHidden(projection, runs).content;
}

const parse = (html) => new DOMParser().parseFromString(html, 'text/html').body;

/**
 * The notes after the text: footnotes, then endnotes, each after the number
 * its reference shows in the text; a note's later paragraphs are indented
 * under the first.
 */
async function appendNotesText(api, text, refs) {
  const { matchNotes, noteBody } = await import('./export-notes.js');
  const used = (await matchNotes(api, refs)).filter(Boolean);
  if (!used.length) return text;
  const sections = [];
  for (const type of ['footnote', 'endnote']) {
    const own = used.filter((entry) => entry.type === type);
    if (!own.length) continue;
    const items = [];
    for (const entry of own) {
      const body = childrenText(parse(await noteBody(api, entry.note, 'html'))).replace(/\uFFFC/g, '').trim();
      items.push(`[${entry.number}] ${body.replace(/\n/g, '\n    ')}`);
    }
    sections.push(`${type === 'endnote' ? 'Endnotes' : 'Footnotes'}\n${items.join('\n')}`);
  }
  return `${text.replace(/\s+$/, '')}\n\n${sections.join('\n\n')}`;
}

/**
 * Read body text with paragraph breaks, list labels, and tab-separated cells;
 * hidden text is left out. With `notes`, each footnote or endnote reference
 * is its number in brackets and the notes follow the text.
 */
export async function readDocumentText(api, { notes = false } = {}) {
  let text;
  const refs = notes ? [] : null;
  if (api?.getHtml || api?.projectHtml) {
    const html = api.projectHtml && (api.export?.toDocx || api.hiddenRunsApplied) ? await visibleHtml(api) ?? await api.getHtml?.({}) : await api.getHtml({});
    if (typeof html !== 'string') throw new Error('No content');
    text = childrenText(parse(html), refs);
  } else {
    text = await api?.getText?.({});
  }
  if (typeof text !== 'string') throw new Error('No content');
  text = text.replace(/\uFFFC/g, '');
  return refs?.length && api.footnotes?.list ? appendNotesText(api, text, refs) : text;
}
