/**
 * Documents often number headings through a list ("1. Introduction", "1.1 Background"),
 * and the engine's HTML projection writes such a heading as a list item, its
 * level lost. The projection marks those items (see export-images.js); here
 * each becomes a heading of its level with its number kept, and the list it
 * sat in is split around it.
 */

import { escapeHtml } from './importers.js';

const LIST_OPEN = /<(ul|ol) data-document-list-labels="explicit">/g;

/** The end of the list element that opens at `start`, counting the lists nested inside it; -1 when it never closes. */
function closeOf(text, start) {
  const tag = /<(\/?)(?:ul|ol)\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0, m;
  while ((m = tag.exec(text))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** The item as a heading: its number in a span, then its text, then any list nested in it after the heading. */
function headingHtml(item, level) {
  const label = [...item.children].find((c) => c.hasAttribute?.('data-document-list-label'));
  const nested = [...item.children].filter((c) => /^(ul|ol)$/i.test(c.tagName));
  for (const list of nested) list.remove();
  label?.remove();
  // The label span's text is decoded markup: a numbering format that holds "<" or "&" must not become live tags.
  const number = escapeHtml((label?.textContent || '').replace(/[\s\u00a0]+$/, ''));
  const text = item.innerHTML.replace(/^\s+/, '');
  return `<h${level}>${number ? `<span class="heading-number">${number}</span> ` : ''}${text}</h${level}>${nested.map((list) => list.outerHTML).join('')}`;
}

/** A list block with its heading items lifted out; the items between headings keep their list. */
function liftInList(block, doc) {
  const list = block.firstElementChild;
  if (!list) return block.innerHTML;
  const out = [];
  let run = null;
  for (const item of [...list.children]) {
    const level = Number(item.getAttribute?.('data-heading-level'));
    if (item.tagName === 'LI' && level >= 1 && level <= 6) {
      run = null;
      out.push(headingHtml(item, level));
      continue;
    }
    if (!run) { run = list.cloneNode(false); out.push(run); }
    run.append(item);
  }
  return out.map((part) => (typeof part === 'string' ? part : part.outerHTML)).join('');
}

/** Exported HTML with the engine's numbered headings as headings; the text itself when there are none. */
export function liftNumberedHeadings(html) {
  const text = String(html ?? '');
  if (typeof DOMParser === 'undefined' || !text.includes('data-heading-level="')) return text;
  let out = '', at = 0, m;
  LIST_OPEN.lastIndex = 0;
  while ((m = LIST_OPEN.exec(text))) {
    const end = closeOf(text, m.index);
    if (end < 0) break;
    const piece = text.slice(m.index, end);
    out += text.slice(at, m.index);
    if (piece.includes('data-heading-level="')) {
      const doc = new DOMParser().parseFromString(piece, 'text/html');
      out += liftInList(doc.body, doc);
    } else out += piece;
    at = end;
    LIST_OPEN.lastIndex = end;
  }
  return out + text.slice(at);
}
