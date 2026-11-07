import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { escapeHtml } from './importers.js';
import { imageImportState, prepareHtmlImages } from './import-images.js';

/** Replace only parsed image source ranges; retain the native Markdown dialect. */
export function prepareMarkdownImages(value) {
  const stack = [{ node: fromMarkdown(value, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), parent: null }], definitions = new Map(), nodes = [];
  while (stack.length) {
    const { node, parent } = stack.pop();
    // Native import currently omits complete footnote definitions. Do not
    // promise a marker inside content that the engine will not insert.
    if (node.type === 'footnoteDefinition') continue;
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === 'image' || node.type === 'imageReference' || node.type === 'html' && /<img\b/i.test(node.value)) nodes.push({ node, parent });
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], parent: node.type });
  }
  if (!nodes.length) return null;
  const state = imageImportState(value), replacements = [];
  for (const { node, parent } of nodes) {
    const destination = node.type === 'imageReference' ? definitions.get(node.identifier) : node;
    if (!destination) continue;
    const html = node.type === 'html' ? node.value
      : `<img src="${escapeHtml(destination.url)}" alt="${escapeHtml(node.alt || '')}" title="${escapeHtml(destination.title || '')}">`;
    // Inline HTML keeps punctuation at both ends, preserving Markdown emphasis
    // delimiter behavior even when the original image touches other text.
    const prepared = prepareHtmlImages(html, state, { inlineMarkers: true, imagesOnly: node.type === 'html' && !['paragraph', 'heading', 'emphasis', 'strong', 'link'].includes(parent) });
    if (!prepared) continue;
    const { start, end } = node.position;
    let replacement = prepared.value;
    if (node.type === 'html' && replacement.includes('\n')) {
      const lineStart = value.lastIndexOf('\n', start.offset - 1) + 1;
      // Continue existing blockquotes/lists when an HTML block spans lines.
      const indentation = value.slice(lineStart, start.offset).replace(/[^>\t ]/g, ' ');
      replacement = replacement.replace(/\n/g, `\n${indentation}`);
    }
    replacements.push({ start: start.offset, end: end.offset, value: replacement });
  }
  if (!replacements.length) return null;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) value = value.slice(0, replacement.start) + replacement.value + value.slice(replacement.end);
  return { value, ...state };
}
