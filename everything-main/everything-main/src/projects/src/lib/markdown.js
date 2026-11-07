/**
 * A deliberately small Markdown subset for task descriptions and comments:
 * headings, paragraphs, lists, blockquotes, code (inline and fenced), bold,
 * italic, links, and autolinked URLs.
 *
 * This half only *parses*, into a tiny AST — the renderer (src/ui/markdown.js)
 * turns that into DOM nodes, never an HTML string. Raw HTML in the source is
 * therefore shown as text, with no sanitizer to get wrong, and links are
 * limited to http(s) here at the parse step.
 *
 * Storage stays plain Markdown text: exports remain human-readable and the
 * data model does not change.
 */

/** Only http(s) survives; anything else (javascript:, data:, //host) is text. */
export function safeHref(url) {
  const trimmed = String(url ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  // A quote or angle bracket in an href is never legitimate here.
  if (/["'<>`]/.test(trimmed)) return null;
  return trimmed;
}

const HR = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const FENCE = /^ {0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
const QUOTE = /^ {0,3}>/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

function startsBlock(line) {
  return HR.test(line) || HEADING.test(line) || FENCE.test(line)
    || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line);
}

export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, mark, lang] = fence;
      const closing = new RegExp(`^ {0,3}${mark}\\s*$`);
      const body = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence, or past the end
      blocks.push({ type: 'code', lang: lang || null, text: body.join('\n') });
      continue;
    }

    if (HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        inline: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i++].replace(/^ {0,3}>\s?/, ''));
      }
      blocks.push({ type: 'quote', inline: parseInline(body.join('\n')) });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const start = ordered ? Number(ORDERED.exec(line)[2]) : null;
      const items = [];
      while (i < lines.length) {
        const m = ordered ? ORDERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (m) {
          items.push([ordered ? m[3] : m[2]]);
          i++;
          continue;
        }
        // An indented, non-empty line continues the item above it.
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1].push(lines[i].trim());
          i++;
          continue;
        }
        break;
      }
      blocks.push({
        type: 'list',
        ordered,
        start,
        items: items.map((parts) => parseInline(parts.join(' ').trim())),
      });
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    blocks.push({ type: 'paragraph', inline: parseInline(para.join('\n')) });
  }

  return blocks;
}

// The URL may carry one level of balanced parens — Wikipedia-style links, and
// it also means an unsafe href is captured whole instead of leaving a stray ")".
//
// Both are sticky: they match at the position the scanner is at, on the
// source itself, instead of on a copy of the rest of the string per attempt.
// The link text also stops at the next "[" — a bracket that opens another
// link is not part of this one's text — so a run of brackets with no closing
// one costs one look each, not one look at everything that follows each. A
// brief pasted with a few thousand stray "[" used to take the home page
// tens of seconds to summarize.
const LINK = /\[([^[\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+"[^"]*")?\s*\)/y;
const AUTOLINK = /https?:\/\/[^\s<>[\]()"']+/iy;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>]/;

export function parseInline(text) {
  const out = [];
  const source = String(text ?? '');
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) { out.push({ type: 'text', value: buffer }); buffer = ''; }
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\' && ESCAPABLE.test(source[i + 1] ?? '')) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    // A single newline inside a paragraph is a visible break here: people
    // writing a spec in a textarea mean the lines they typed.
    if (ch === '\n') { flush(); out.push({ type: 'break' }); i++; continue; }

    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', value: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (source.startsWith('**', i) || source.startsWith('__', i)) {
      const marker = source.slice(i, i + 2);
      const end = source.indexOf(marker, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const end = source.indexOf(ch, i + 1);
      const opensWell = !/\s/.test(source[i + 1] ?? ' ');
      // snake_case and file_names are not emphasis.
      const wordBoundary = ch === '*' || !/\w/.test(source[i - 1] ?? '');
      if (end > i + 1 && opensWell && wordBoundary) {
        flush();
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(source);
      if (m) {
        const href = safeHref(m[2]);
        flush();
        if (href) out.push({ type: 'link', href, children: parseInline(m[1]) });
        // A link this app will not follow degrades to its own text.
        else out.push({ type: 'text', value: m[1] || m[2] });
        i += m[0].length;
        continue;
      }
    }

    AUTOLINK.lastIndex = i;
    if ((ch === 'h' || ch === 'H') && AUTOLINK.test(source)) {
      AUTOLINK.lastIndex = i;
      const raw = AUTOLINK.exec(source)[0];
      // Trailing punctuation belongs to the sentence, not the URL.
      const url = raw.replace(/[.,;:!?]+$/, '');
      const href = safeHref(url);
      if (href) {
        flush();
        out.push({ type: 'link', href, children: [{ type: 'text', value: url }] });
        i += url.length;
        continue;
      }
    }

    buffer += ch;
    i++;
  }

  flush();
  return out;
}

/** True when rendering would add anything beyond plain paragraphs of text. */
export function hasMarkdown(text) {
  return /(^|\n) {0,3}([#>]|\d{1,9}[.)]\s|[-*+]\s|```)|(\*\*|__|`|\[[^[\]]*\]\(|https?:\/\/)/.test(
    String(text ?? ''),
  );
}

/** Every text node under an inline AST, concatenated. */
function inlineText(nodes) {
  return nodes.map((node) => {
    if (node.type === 'break') return ' ';
    if (node.children) return inlineText(node.children);
    return node.value ?? '';
  }).join('');
}

/**
 * Markdown as one line of plain text, for the places that have room for a
 * sentence rather than a document — a project card, a CSV cell. Formatting is
 * dropped rather than shown as syntax: a card reading "## Goals - ship it"
 * is worse than no summary at all.
 */
export function plainSummary(text, max = 140) {
  const parts = [];
  for (const block of parseMarkdown(text)) {
    if (block.type === 'code') parts.push(block.text);
    else if (block.type === 'list') parts.push(block.items.map(inlineText).join(' · '));
    else if (block.inline) parts.push(inlineText(block.inline));
    if (parts.join(' ').length >= max) break;
  }
  const flat = parts.join(' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
