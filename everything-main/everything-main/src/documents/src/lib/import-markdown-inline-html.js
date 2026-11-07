import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { htmlBody } from './importers.js';

/** Render mixed inline HTML in one context so tags can span paragraph boundaries. */
export async function markdownWithInlineHtml(value) {
  if (typeof DOMParser === 'undefined') return null;
  // Resolve source line endings before decoded character references can make
  // their carriage returns indistinguishable from raw source CR characters.
  value = value.replace(/\r\n?/g, '\n');
  const tree = fromMarkdown(value, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const stack = [{ node: tree, parent: null }];
  let inlineHtml = false;
  while (stack.length) {
    const { node, parent } = stack.pop();
    if (node.type === 'footnoteDefinition') continue;
    if (node.type === 'html' && !['root', 'listItem', 'blockquote'].includes(parent)) { inlineHtml = true; break; }
    if (node.children) for (const child of node.children) stack.push({ node: child, parent: node.type });
  }
  if (!inlineHtml) return null;
  const [{ defaultHandlers, toHast }, { toHtml }] = await Promise.all([import('mdast-util-to-hast'), import('hast-util-to-html')]);
  // Footnote import still uses the native engine's existing omission behavior;
  // do not turn references into detached numeric links or append fake notes.
  const html = toHtml(toHast(tree, { allowDangerousHtml: true, handlers: {
    footnoteReference: () => [],
    text(state, node) {
      // Markdown has already decoded numeric references. Keep their CR as a
      // CSS space before HTML serialization would make it a source newline.
      return defaultHandlers.text(state, node.value.includes('\r') ? { ...node, value: node.value.replaceAll('\r', ' ') } : node);
    },
    tableRow(state, node, parent) {
      // Native Markdown retains excess cells; the default renderer truncates
      // each row to its alignment array. Keep those existing cell contents.
      const align = parent?.type === 'table' ? parent.align : null;
      if (align && node.children.length > align.length) parent = { ...parent, align: Array.from({ length: node.children.length }, (_, index) => align[index] || null) };
      return defaultHandlers.tableRow(state, node, parent);
    },
  } }), { allowDangerousHtml: true });
  // This markup is never mounted. The same inert cleanup and native sanitizer
  // used for HTML files process it before any document content is inserted.
  return htmlBody(html, { preserveFallback: true });
}
