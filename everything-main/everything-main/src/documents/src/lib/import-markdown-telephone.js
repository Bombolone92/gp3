import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { escapeHtml } from './importers.js';
import { telephoneSurrogate } from './import-telephone.js';

/** Keep label source intact and leave shared reference definitions untouched. */
export function prepareMarkdownTelephone(value, telephones) {
  const stack = [{ node: fromMarkdown(value, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), note: false }];
  const definitions = new Map(), links = [];
  while (stack.length) {
    const { node, note } = stack.pop();
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (!note && (node.type === 'link' || node.type === 'linkReference')) links.push(node);
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], note: note || node.type === 'footnoteDefinition' });
  }
  const replacements = [];
  for (const link of links) {
    const destination = link.type === 'linkReference' ? definitions.get(link.identifier) : link;
    const surrogate = destination && telephoneSurrogate(value, destination.url, telephones);
    if (!surrogate) continue;
    const { start, end } = link.position;
    let label;
    if (value[start.offset] === '<') {
      // Autolink labels are literal text, including punctuation and ampersands.
      label = escapeHtml(link.children.map(child => child.value || '').join('')).replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&');
    } else {
      const labelEnd = link.children.at(-1)?.position.end.offset ?? start.offset + 1;
      if (value[start.offset] !== '[' || value[labelEnd] !== ']') throw new Error('Could not locate an imported telephone link label');
      label = value.slice(start.offset + 1, labelEnd);
    }
    const title = destination.title == null ? '' : ` "${destination.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    replacements.push({ start: start.offset, end: end.offset, value: `[${label}](${surrogate}${title})` });
  }
  for (const replacement of replacements.reverse()) value = value.slice(0, replacement.start) + replacement.value + value.slice(replacement.end);
  return value;
}
