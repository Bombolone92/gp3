import { el } from '../lib/dom.js';
import { parseMarkdown, parseInline } from '../lib/markdown.js';

/**
 * Render the Markdown subset as DOM nodes. Nothing here ever touches
 * innerHTML, so raw HTML in a description or comment is displayed as the text
 * it is — there is no sanitizer to bypass.
 */

function inlineNodes(nodes) {
  return nodes.map((node) => {
    switch (node.type) {
      case 'strong': return el('strong', {}, inlineNodes(node.children));
      case 'em': return el('em', {}, inlineNodes(node.children));
      case 'code': return el('code', {}, node.value);
      case 'break': return el('br');
      case 'link': return el('a', {
        href: node.href,
        target: '_blank',
        // Untrusted destination: no window.opener, no referrer.
        rel: 'noopener noreferrer nofollow ugc',
      }, inlineNodes(node.children));
      default: return document.createTextNode(node.value ?? '');
    }
  });
}

function blockNode(block) {
  switch (block.type) {
    case 'heading':
      return el(`h${Math.min(block.level + 2, 6)}.md-h`, {}, inlineNodes(block.inline));
    case 'code':
      return el('pre.md-pre', {}, el('code', {}, block.text));
    case 'quote':
      return el('blockquote.md-quote', {}, inlineNodes(block.inline));
    case 'hr':
      return el('hr.md-hr');
    case 'list':
      return el(block.ordered ? 'ol.md-list' : 'ul.md-list', {
        start: block.ordered && block.start > 1 ? block.start : null,
      }, block.items.map((item) => el('li', {}, inlineNodes(item))));
    default:
      return el('p.md-p', {}, inlineNodes(block.inline));
  }
}

/** Rendered Markdown as a fragment. */
export function markdownFragment(text) {
  const frag = document.createDocumentFragment();
  for (const block of parseMarkdown(text)) frag.append(blockNode(block));
  return frag;
}

/** A container div (class `md`) holding the rendered text. */
export function markdownView(text, extraClass = '') {
  const wrap = el(`div.md${extraClass ? `.${extraClass}` : ''}`);
  wrap.append(markdownFragment(text));
  return wrap;
}

/** Inline-only rendering: the same emphasis, code, and links, no blocks. */
export function inlineMarkdown(text) {
  const frag = document.createDocumentFragment();
  frag.append(...inlineNodes(parseInline(text)));
  return frag;
}
