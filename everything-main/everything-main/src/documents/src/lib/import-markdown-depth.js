/**
 * DOCX has nine list levels, and the converter refuses a Markdown list nested
 * deeper rather than clamping it, so an outline exported from a mind map or a
 * deeply indented to-do tree failed to import as a whole. Items past the ninth
 * level are lifted into the ninth list, after the item that held them, so the
 * document imports with its text in order and only the deepest indentation lost.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

export const MAX_LIST_LEVELS = 9;

// A tenth level needs at least two spaces of indentation per level (Markdown's
// minimum) before its marker; a tab counts as four columns. Nothing shallower is parsed.
const DEEP_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/m;
function mayHaveDeepList(value) {
  DEEP_LINE.lastIndex = 0;
  for (const line of value.split('\n')) {
    let columns = 0, i = 0;
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) { columns += line[i] === '\t' ? 4 : 1; i++; }
    if (columns >= 2 * MAX_LIST_LEVELS && DEEP_LINE.test(line)) return true;
  }
  return false;
}

/**
 * Lift every list nested past the limit into the list above it (its items
 * follow the item that held them); true when something moved. `ancestors`
 * leads from the root down to `node`'s parent.
 */
function hoistOnce(node, ancestors = []) {
  let moved = false;
  if (!Array.isArray(node.children)) return false;
  const enclosing = [...ancestors, node].filter((a) => a.type === 'list').length;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'list' && enclosing >= MAX_LIST_LEVELS && node.type === 'listItem' && ancestors.at(-1)?.type === 'list') {
      const list = ancestors.at(-1);
      node.children.splice(i, 1);
      list.children.splice(list.children.indexOf(node) + 1, 0, ...child.children);
      moved = true;
      i -= 1;
      continue;
    }
    if (hoistOnce(child, [...ancestors, node])) moved = true;
  }
  return moved;
}

/**
 * The Markdown with no list deeper than nine levels; the text itself when it
 * has none (the common case, and then it is not even parsed).
 */
export function flattenDeepMarkdownLists(value) {
  const text = String(value ?? '');
  if (!mayHaveDeepList(text)) return text;
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  let changed = false;
  while (hoistOnce(tree)) changed = true;
  if (!changed) return text;
  return toMarkdown(tree, { extensions: [gfmToMarkdown()] });
}
