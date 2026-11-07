/**
 * Splitting a large Markdown or HTML import into pieces the engine's
 * converter accepts. The converter refuses a single conversion of more than
 * about a thousand blocks, a few hundred links, or 500,000 characters of
 * source (UTF-16 units, whatever the script); a long list or a book-length
 * page therefore goes in as several inserts, each appended after the last.
 * Plain text has no such limit.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

/** Comfortably under the converter's limits, so the count of nested blocks the source hides never reaches them. */
export const CHUNK_LIMITS = { blocks: 400, links: 120, bytes: 384 * 1024 };

const MD_BLOCKS = new Set(['paragraph', 'heading', 'thematicBreak', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'tableCell', 'html', 'code', 'footnoteDefinition', 'definition']);
const MD_LINKS = new Set(['link', 'linkReference', 'image', 'imageReference']);
const MD_REFERENCES = new Set(['linkReference', 'imageReference', 'footnoteReference']);
const HTML_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote, pre, table, hr, div, section, article, header, footer, figure, figcaption, dl, dt, dd, ul, ol';

/** Block and link counts of a Markdown node and everything inside it. */
function weigh(node) {
  let blocks = 0, links = 0;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (MD_BLOCKS.has(n.type)) blocks += 1;
    if (MD_LINKS.has(n.type)) links += 1;
    if (n.children) stack.push(...n.children);
  }
  return { blocks: Math.max(1, blocks), links };
}

const overBudget = (total, add, limits) => total.blocks + add.blocks > limits.blocks || total.links + add.links > limits.links || total.bytes + add.bytes > limits.bytes;

/** The identifiers of the link, image, and footnote references in a node and everything inside it. */
function referenced(node, into) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (MD_REFERENCES.has(n.type) && n.identifier != null) into.add(n.identifier);
    if (n.children) stack.push(...n.children);
  }
  return into;
}

/**
 * Markdown split at top-level blocks. Link and footnote definitions apply
 * to the whole document, so a piece carries the definitions it refers to
 * (and only those: a bibliography of hundreds of definitions appended to
 * every piece would put each piece back over the budget). Returns null when
 * the source fits one conversion.
 */
export function splitMarkdown(source, limits = CHUNK_LIMITS) {
  const text = String(source ?? '');
  const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const nodes = (root.children || []).filter((n) => n.position);
  if (!nodes.length) return null;
  const whole = weigh(root);
  if (whole.blocks <= limits.blocks && whole.links <= limits.links && text.length <= limits.bytes) return null;
  const definitions = nodes.filter((n) => n.type === 'definition' || n.type === 'footnoteDefinition')
    .map((n) => ({ identifier: n.identifier, source: text.slice(n.position.start.offset, n.position.end.offset) }));
  const chunks = [];
  let current = [], total = { blocks: 0, links: 0, bytes: 0 };
  const flush = () => {
    if (!current.length) return;
    const start = current[0].position.start.offset, end = current.at(-1).position.end.offset;
    let piece = text.slice(start, end);
    // A piece that starts inside a numbered list opens with the item's own number, so the list counts on
    // across the pieces even when the source writes "1." on every line.
    if (current[0].ordinal != null) piece = piece.replace(/^(\d+)([.)])/, (m, digits, delimiter) => `${current[0].ordinal}${delimiter}`);
    const wanted = new Set();
    for (const node of current) referenced(node, wanted);
    for (const { identifier, source } of definitions) if (wanted.has(identifier) && !piece.includes(source)) piece += `\n\n${source}`;
    chunks.push(piece);
    current = []; total = { blocks: 0, links: 0, bytes: 0 };
  };
  // A list longer than the budget splits between its items: each item's
  // source starts with its own marker (and number), so the pieces are lists.
  // Definitions travel with the pieces that refer to them, not on their own.
  const units = nodes.filter((n) => n.type !== 'definition' && n.type !== 'footnoteDefinition').flatMap((node) => (node.type === 'list' && node.children?.length > 1 && weigh(node).blocks > limits.blocks
    ? node.children.filter((item) => item.position).map((item, index) => Object.assign(item, { ordinal: node.ordered ? (node.start ?? 1) + index : null })) : [node]));
  for (const node of units) {
    const size = { ...weigh(node), bytes: node.position.end.offset - node.position.start.offset };
    if (current.length && overBudget(total, size, limits)) flush();
    current.push(node);
    total = { blocks: total.blocks + size.blocks, links: total.links + size.links, bytes: total.bytes + size.bytes };
  }
  flush();
  return chunks.length > 1 ? chunks : null;
}

/** Elements that only group their content: their children stand on their own in a piece. */
const HTML_WRAPPERS = new Set(['BODY', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'CENTER', 'FONT', 'SPAN']);
const INLINE_WRAPPERS = new Set(['FONT', 'SPAN']);
/** Wrapper attributes the converter reads; a class or id would only lengthen the pieces. */
const STYLING_ATTRIBUTES = ['dir', 'style', 'align', 'lang', 'face', 'color', 'size', 'bgcolor'];

const serializeHtml = (node) => (node.nodeType === 1 ? node.outerHTML : node.nodeType === 3 ? node.data.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) : '');

/**
 * The pieces a node splits into when it alone is over the budget: a wrapper
 * (a saved web page keeps its whole text in one div) opens up to its
 * children, a list splits between its items, each still a list with its
 * number, and a quotation between its paragraphs, each still quoted. Any
 * other node, or one within the budget, is a piece of its own.
 */
function* htmlUnits(node, limits, weight) {
  if (node.nodeType !== 1) { yield node; return; }
  const size = weight(node);
  const over = size.blocks > limits.blocks || size.links > limits.links || node.outerHTML.length > limits.bytes;
  if (!over) { yield node; return; }
  if (HTML_WRAPPERS.has(node.tagName)) {
    // A span or font holding only inline content is one paragraph's text: opened up, its pieces would each start a paragraph.
    if (INLINE_WRAPPERS.has(node.tagName) && !node.querySelector(HTML_BLOCKS)) { yield node; return; }
    const styled = node.tagName !== 'BODY' && STYLING_ATTRIBUTES.some((name) => node.hasAttribute(name));
    // The wrapper's own direction, alignment, and font still apply to each piece: it keeps a shell of the wrapper.
    const shelled = (units) => { if (!styled) return units.length === 1 ? units[0] : units; const shell = node.cloneNode(false); shell.append(...units); return shell; };
    const blank = (n) => n.nodeType === 8 || (n.nodeType === 3 && !n.data.trim());
    // Text, links and line breaks written straight into the wrapper form lines; a line stays one piece.
    // A span or font holding only inline content is part of the line it sits on, like a link or a bold run.
    const isBlock = (n) => n.nodeType === 1 && (n.matches(HTML_BLOCKS) || (HTML_WRAPPERS.has(n.tagName) && !(INLINE_WRAPPERS.has(n.tagName) && !n.querySelector(HTML_BLOCKS))));
    let line = [];
    const flushLine = function* () {
      const kept = line; line = [];
      // Whitespace and comments between blocks would each become an empty paragraph in a shell of the wrapper.
      if (kept.every(blank)) return;
      yield shelled(kept);
    };
    for (const child of [...node.childNodes]) {
      if (!isBlock(child)) {
        line.push(child);
        if (child.nodeType === 1 && child.tagName === 'BR') yield* flushLine();
        continue;
      }
      yield* flushLine();
      for (const unit of htmlUnits(child, limits, weight)) yield shelled(Array.isArray(unit) ? unit : [unit]);
    }
    yield* flushLine();
    return;
  }
  if ((node.tagName === 'UL' || node.tagName === 'OL') && node.children.length > 1) {
    // Items are grouped into as few lists as the limits allow: every piece becomes a list of its own in the
    // document, and one list per item would give the numbering, Enter and "Continue list" hundreds of lists.
    let number = Number.parseInt(node.getAttribute('start') || '1', 10) || 1;
    let group = null, groupStart = number, groupSize = null;
    const flushGroup = function* () {
      if (!group) return;
      if (node.tagName === 'OL') group.setAttribute('start', String(groupStart));
      yield group;
      group = null;
    };
    for (const item of [...node.children]) {
      const itemSize = weight(item), itemBytes = item.outerHTML.length;
      if (group && (groupSize.blocks + itemSize.blocks > limits.blocks || groupSize.links + itemSize.links > limits.links || groupSize.bytes + itemBytes > limits.bytes)) yield* flushGroup();
      if (!group) { group = node.cloneNode(false); groupStart = number; groupSize = { blocks: 0, links: 0, bytes: 0 }; }
      group.append(item.cloneNode(true));
      groupSize.blocks += itemSize.blocks; groupSize.links += itemSize.links; groupSize.bytes += itemBytes;
      number += 1;
    }
    yield* flushGroup();
    return;
  }
  if (node.tagName === 'BLOCKQUOTE' && node.childNodes.length > 1) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3 && !child.data.trim()) continue;
      const quote = node.cloneNode(false);
      quote.append(child.cloneNode(true));
      yield quote;
    }
    return;
  }
  yield node;
}

/** HTML split at the body's top-level elements, and inside the ones that are themselves too big. Returns null when it fits one conversion. */
export function splitHtml(source, limits = CHUNK_LIMITS) {
  if (typeof DOMParser === 'undefined') return null;
  const text = String(source ?? '');
  const body = new DOMParser().parseFromString(text, 'text/html').body;
  const linksIn = (node) => (node.nodeType === 1 ? node.querySelectorAll('a[href], img').length + (node.matches('a[href], img') ? 1 : 0) : 0);
  const weigh = (node) => (node.nodeType === 1 ? { blocks: 1 + node.querySelectorAll(HTML_BLOCKS).length, links: linksIn(node) } : { blocks: 1, links: 0 });
  // A line of inline content is one unit: one block, and the links it holds.
  const weight = (unit) => (Array.isArray(unit) ? { blocks: 1, links: unit.reduce((sum, n) => sum + linksIn(n), 0) } : weigh(unit));
  const whole = weight(body);
  if (whole.blocks - 1 <= limits.blocks && whole.links <= limits.links && text.length <= limits.bytes) return null;
  const chunks = [];
  let current = [], total = { blocks: 0, links: 0, bytes: 0 };
  const serialize = serializeHtml;
  const flush = () => { if (current.length) { chunks.push(current.join('')); current = []; total = { blocks: 0, links: 0, bytes: 0 }; } };
  for (const node of htmlUnits(body, limits, weight)) {
    const html = Array.isArray(node) ? node.map(serialize).join('') : serialize(node);
    if (!html.trim()) continue;
    const size = { ...weight(node), bytes: html.length };
    if (current.length && overBudget(total, size, limits)) flush();
    current.push(html);
    total = { blocks: total.blocks + size.blocks, links: total.links + size.links, bytes: total.bytes + size.bytes };
  }
  flush();
  return chunks.length > 1 ? chunks : null;
}

/** The pieces of a payload that needs more than one conversion, or null. */
export function splitImport(payload, limits = CHUNK_LIMITS) {
  if (payload?.type === 'markdown') return splitMarkdown(payload.value, limits);
  if (payload?.type === 'html') return splitHtml(payload.value, limits);
  return null;
}
