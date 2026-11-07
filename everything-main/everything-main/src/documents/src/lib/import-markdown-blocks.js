import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { htmlBody } from './importers.js';
import { imageImportState, prepareHtmlImages } from './import-images.js';
import { prepareHtmlTelephone } from './import-telephone.js';
import { htmlToFragmentWithStyles } from './import-html-styles.js';
import { prepareAlignment } from './import-alignment.js';
import { preparePreParagraphs } from './import-pre.js';

function fragment(result, { allowEmpty = false, diagnostics = null, block = null } = {}) {
  const error = result?.diagnostics?.find(diagnostic => diagnostic.severity === 'error' && !(allowEmpty && diagnostic.code === 'conversion-empty-result' && result.fragment?.length === 0));
  if (error || !Array.isArray(result?.fragment)) throw new Error(error?.message || 'Could not convert embedded HTML');
  // The conversions' notes (pictures left out, styles dropped) are the only record of them: the insert receipt has none.
  // Each block is converted on its own, so a note's path is relative to its block: the block's number keeps two blocks' notes apart.
  if (diagnostics && Array.isArray(result.diagnostics)) diagnostics.push(...result.diagnostics.map((diagnostic) => (block != null && Array.isArray(diagnostic?.path) ? { ...diagnostic, path: [`block${block}`, ...diagnostic.path] } : diagnostic)));
  return result.fragment;
}

// A standalone HTML list starts at level zero. Inside a Markdown list item it
// needs that item's depth, including its numbering path, before insertion.
// DOCX lists have nine levels: a list that would go deeper stays at the ninth, and one
// held by an item already at the ninth becomes that item's further paragraphs,
// since a list nested there has no level left to take.
const MAX_LEVEL = 8;
const paragraphsOf = (list) => list.items.flatMap((item) => item.content.flatMap((block) => (block.kind === 'list' ? paragraphsOf(block.list) : [block])));
function nestLists(blocks, parent) {
  if (!parent) return blocks;
  return blocks.flatMap((block) => {
    if (block.kind !== 'list') return [block];
    if (parent.level >= MAX_LEVEL) return paragraphsOf(block.list);
    const shift = parent.level + 1;
    const seen = new Set();
    block.list.levels = block.list.levels.map((level) => ({ ...level, level: Math.min(MAX_LEVEL, level.level + shift) })).filter((level) => !seen.has(level.level) && seen.add(level.level));
    for (const item of block.list.items) {
      item.level = Math.min(MAX_LEVEL, item.level + shift);
      item.path = [...parent.path, ...item.path].slice(-(item.level + 1));
    }
    return [block];
  });
}

/** Convert raw HTML blocks separately, then compose native fragments before writing. */
export async function prepareMarkdownBlocks(api, value, images = null, telephones = null) {
  if (typeof DOMParser === 'undefined') return null;
  const stack = [{ node: fromMarkdown(value, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), parent: null }], nodes = [];
  while (stack.length) {
    const { node, parent } = stack.pop();
    if (node.type === 'footnoteDefinition') continue;
    if (node.type === 'html' && ['root', 'listItem', 'blockquote'].includes(parent)) nodes.push(node);
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], parent: node.type });
  }
  if (!nodes.length) return null;
  const state = images ? { prefix: images.prefix, images: images.images, sources: images.sources } : imageImportState(value);
  const blocks = new Map(), replacements = [], diagnostics = [];
  // Numbers the blocks as converted, including ones that convert to nothing, so no two blocks' notes share a number.
  let converted = 0;
  let prefix;
  do { prefix = `SDIMPORTBLOCK${crypto.randomUUID().replaceAll('-', '')}X`; } while (value.includes(prefix));
  for (const node of nodes) {
    let html = preparePreParagraphs(await prepareAlignment(htmlBody(node.value)));
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    // Bare opening/closing wrappers around Markdown paragraphs add no blocks.
    const text = body.textContent;
    const styledWhitespace = text.length && /white-space\s*:\s*(?:pre(?:-wrap)?|break-spaces)(?![\w-])/i.test(html);
    const emptyWrapper = !text.trim() && !styledWhitespace && !body.querySelector('img,p,h1,h2,h3,h4,h5,h6,br,hr,table,li,pre');
    if (emptyWrapper && !(text.includes('\n') && /white-space\s*:\s*pre-line(?![\w-])/i.test(html))) continue;
    const imageCount = state.images.length;
    // Cleanup has canonicalized tag names, including HTML's <image> alias.
    if (/<img\b/i.test(html) && api.find && api.create?.image && api.delete) html = prepareHtmlImages(html, state)?.value || html;
    const blockTelephones = telephones ? new Map() : null;
    html = prepareHtmlTelephone(html, blockTelephones);
    const content = fragment(await htmlToFragmentWithStyles(api, html), { allowEmpty: true, diagnostics, block: converted++ });
    // pre-line preserves LF, but child overrides can collapse those breaks.
    // Keep a whitespace-only wrapper only when a break actually survived.
    const collapsedBreaks = emptyWrapper
      && !content.some(block => block[block.kind]?.inlines?.some(inline => inline.kind === 'lineBreak'));
    if (!content.length || collapsedBreaks) { state.images.length = imageCount; continue; }
    if (blockTelephones) for (const [surrogate, href] of blockTelephones) telephones.set(surrogate, href);
    const marker = `${prefix}${blocks.size}Z`;
    blocks.set(marker, content);
    const { start, end } = node.position;
    const lineStart = value.lastIndexOf('\n', start.offset - 1) + 1;
    const indentation = value.slice(lineStart, start.offset).replace(/[^>\t ]/g, ' ');
    // A heading interrupts adjacent paragraphs without loosening a tight list.
    // It is replaced in the canonical fragment, never written to the document.
    replacements.push({ start: start.offset, end: end.offset, value: `# ${marker}\n${indentation}` });
  }
  // Every block converted to nothing (each held only a picture the converter left out): the notes about them are still the record of the pictures.
  if (!blocks.size) return diagnostics.length ? { content: null, images: null, diagnostics } : null;
  for (const replacement of replacements.reverse()) value = value.slice(0, replacement.start) + replacement.value + value.slice(replacement.end);
  const content = fragment(await api.markdownToFragment({ markdown: value }), { diagnostics }), found = new Set();
  function compose(items, parent = null) {
    return items.flatMap(block => {
      const inlines = block[block.kind]?.inlines;
      const marker = inlines?.every(inline => inline.kind === 'run') ? inlines.map(inline => inline.run.text || '').join('') : null;
      if (blocks.has(marker)) {
        if (found.has(marker)) throw new Error('Could not locate embedded HTML');
        found.add(marker);
        return nestLists(blocks.get(marker), parent);
      }
      if (block.kind === 'list') for (const item of block.list.items) item.content = compose(item.content, item);
      if (block.kind === 'table') for (const row of block.table.rows) for (const cell of row.cells) cell.content = compose(cell.content);
      return [block];
    });
  }
  const combined = compose(content);
  if (found.size !== blocks.size) throw new Error('Could not locate embedded HTML');
  return { content: combined, images: state.images.length ? state : null, diagnostics };
}
