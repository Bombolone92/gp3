/**
 * Lists in the engine's Markdown projection. The engine writes every list as
 * a block of raw HTML (an <ol> or <ul> marked data-document-list-labels with
 * the marker text of each item in a span), because Markdown cannot carry a
 * list's exact numbering. Markdown readers that strip styles then show the
 * marker twice, and plain ones show the tags. Those blocks become Markdown
 * list lines here: bullets, numbers that Markdown understands, nesting by
 * indentation, and the inline formatting Markdown has words for.
 */

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

/** Stands in for a line break inside an item until the item's indentation is known. */
const BREAK = '\uE000';

/**
 * `text` between Markdown delimiters. A delimiter next to a space is not
 * one ("**bold **and" shows its asterisks), and a double-clicked word
 * often takes its trailing space along, so the spaces stay outside.
 */
function wrapped(text, mark) {
  const [, before, core, after] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return core ? `${before}${mark}${core}${mark}${after}` : text;
}

/**
 * Text as Markdown reads it literally: the punctuation Markdown gives a
 * meaning (and the angle brackets HTML does) escaped, as the engine escapes
 * it in ordinary paragraphs, so a typed "*star*" or "<b>" stays text.
 */
const escapeMarkdown = (text) => text.replace(/[\\`*_{}[\]()#+\-.!|<>&~]/g, '\\$&');
// A heading's number stays readable ("1.", "1.1", "a)"): only markup and emphasis characters in it are escaped.
const escapeLabel = (label) => label.replace(/[\\`*_{}[\]<>&~]/g, '\\$&');

/** A code span: literal, fenced with more backticks than it holds. */
function codeSpan(text) {
  if (!text.trim()) return text;
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A link or picture destination: spaces and parentheses would end it early. */
const destination = (url) => url.replace(/ /g, '%20').replace(/[()]/g, (c) => `\\${c}`);

/** Inline HTML inside an item as Markdown; anything without a Markdown form keeps its text. */
function inlineMarkdown(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out += escapeMarkdown(child.data); continue; }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'span' && child.hasAttribute('data-document-list-label')) continue;
    // A note reference is numbered by the notes pass afterwards; its brackets are not text to escape.
    if (tag === 'span' && child.getAttribute('data-document-placeholder') === 'note') { out += child.outerHTML; continue; }
    // An empty span with an id is a bookmark target the links in the document point to; Markdown keeps it as HTML.
    if (tag === 'span' && child.id && !child.textContent) { out += child.outerHTML; continue; }
    if (tag === 'ul' || tag === 'ol') continue;
    const inner = inlineMarkdown(child);
    if (tag === 'br') out += BREAK;
    else if (tag === 'strong' || tag === 'b') out += wrapped(inner, '**');
    else if (tag === 'em' || tag === 'i') out += wrapped(inner, '*');
    else if (tag === 's' || tag === 'del' || tag === 'strike') out += wrapped(inner, '~~');
    else if (tag === 'code') out += codeSpan(child.textContent);
    else if (tag === 'a' && child.getAttribute('href')) out += `[${inner}](${destination(child.getAttribute('href'))})`;
    else if (tag === 'img' && child.getAttribute('src')) out += `![${escapeMarkdown(child.getAttribute('alt') || '')}](${destination(child.getAttribute('src'))})`;
    else out += inner;
  }
  return out;
}

/** The marker the engine wrote for an item, without its tab or space. */
function labelOf(item) {
  const label = [...item.children].find((c) => c.hasAttribute?.('data-document-list-label'));
  return (label?.textContent || '').replace(/[\s ]+$/, '');
}

function listLines(list, indent, lines) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  let index = 0;
  for (const item of list.children) {
    if (item.tagName.toLowerCase() !== 'li') continue;
    const label = labelOf(item);
    // A numbered heading the engine wrote as an item (marked by the projection) is a heading line, its number kept; it
    // ends the list around it, so the items after it start a list of their own.
    const level = Number(item.getAttribute('data-heading-level'));
    if (level >= 1 && level <= 6) {
      const text = inlineMarkdown(item).replace(/\s+/g, ' ').replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '').split(BREAK).map((part) => part.trim()).join(' ');
      if (lines.length && lines.at(-1) !== '') lines.push('');
      lines.push(`${'#'.repeat(level)} ${label ? `${escapeLabel(label)} ` : ''}${text}`);
      // A list line after the heading needs a blank line between them; a trailing one is trimmed by the caller.
      lines.push('');
      for (const nested of item.children) if (/^(ul|ol)$/i.test(nested.tagName)) listLines(nested, '', lines);
      index = 0;
      continue;
    }
    index += 1;
    // Markdown numbers items with digits and a period or parenthesis; letters and roman numerals count on as digits.
    // A checkbox bullet (a to-do list in the document) keeps its state as a task list item.
    const marker = ordered ? (/^\d{1,9}[.)]$/.test(label) ? label : `${index}.`) : label === '☐' ? '- [ ]' : /^[☑☒✓✔]$/.test(label) ? '- [x]' : '-';
    const deeper = `${indent}${' '.repeat(marker.length + 1)}`;
    // Newlines in the source are spaces; a line break becomes a hard break, its continuation indented to the item's text.
    const text = inlineMarkdown(item).replace(/\s+/g, ' ').replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '')
      .split(BREAK).map((part) => part.trim()).join(`  \n${deeper}`);
    lines.push(`${indent}${marker} ${text}`);
    for (const nested of item.children) if (/^(ul|ol)$/i.test(nested.tagName)) listLines(nested, deeper, lines);
  }
}

/** The Markdown projection with its raw-HTML lists rewritten as Markdown lists. Without a DOM parser the text is returned as it is. */
export function markdownLists(markdown) {
  const text = String(markdown ?? '');
  if (typeof DOMParser === 'undefined' || !text.includes('data-document-list-labels="explicit"')) return text;
  let out = '', at = 0, m, previous = null;
  LIST_OPEN.lastIndex = 0;
  while ((m = LIST_OPEN.exec(text))) {
    const end = closeOf(text, m.index);
    if (end < 0) break;
    const body = new DOMParser().parseFromString(text.slice(m.index, end), 'text/html').body;
    const lines = [];
    for (const list of body.children) if (/^(ul|ol)$/i.test(list.tagName)) listLines(list, '', lines);
    while (lines.length && lines.at(-1) === '') lines.pop();
    out += text.slice(at, m.index);
    if (lines.length) {
      // The engine writes one list right after another on the same line; each is a paragraph of its own.
      if (out && !/\n\s*$/.test(out)) out += '\n\n';
      // Two lists of one kind with nothing between them would read as one list
      // (a restarted numbering carrying on); a comment keeps them apart.
      if (previous?.kind === m[1] && !text.slice(previous.end, m.index).trim()) out += '<!-- -->\n\n';
      out += lines.join('\n');
      if (end < text.length && !/^\s*\n/.test(text.slice(end))) out += '\n\n';
      previous = { kind: m[1], end };
    } else out += text.slice(m.index, end);
    at = end;
    LIST_OPEN.lastIndex = end;
  }
  return out + text.slice(at);
}
