/**
 * HTML the converter reads poorly, rewritten into what it reads well before
 * an import: definition lists collapse into one paragraph, a table's caption
 * is dropped, a checkbox's state is lost, and hidden markup is imported as
 * visible text. Each is put into the form the converter handles: paragraphs
 * and plain characters. (<font> is the font-family module's business.)
 */

const hidden = (node) => node.hasAttribute('hidden') || /(?:^|;)\s*display\s*:\s*none\b/i.test(node.getAttribute('style') || '');

/** Rewrite the markup under `root` (a parsed document's body) in place. */
export function normalizeMarkup(root) {
  const doc = root.ownerDocument;
  // Hidden content is not part of the page as read.
  for (const node of [...root.querySelectorAll('[hidden], [style*="display"]')]) if (node.isConnected && hidden(node)) node.remove();
  // A definition list: the term in bold, its definition as a paragraph of its own.
  // Groups of terms and definitions may be wrapped in divs, as HTML allows.
  const entries = (parent) => [...parent.children].flatMap((child) => (child.tagName === 'DIV' ? entries(child) : [child]));
  for (const dl of [...root.querySelectorAll('dl')].reverse()) {
    const replacement = [];
    for (const child of entries(dl)) {
      if (child.tagName === 'DT') { const p = doc.createElement('p'); const b = doc.createElement('b'); b.append(...child.childNodes); p.append(b); replacement.push(p); }
      else if (child.tagName === 'DD') { const p = doc.createElement('p'); p.append(...child.childNodes); replacement.push(p); }
      else replacement.push(child);
    }
    dl.replaceWith(...replacement);
  }
  // A table's caption stands as a centered italic line before the table.
  for (const caption of [...root.querySelectorAll('table > caption')]) {
    const p = doc.createElement('p');
    p.setAttribute('style', 'text-align:center');
    const i = doc.createElement('i');
    i.append(...caption.childNodes);
    p.append(i);
    caption.closest('table').before(p);
    caption.remove();
  }
  // A task list's checkboxes become the characters that show their state.
  for (const box of [...root.querySelectorAll('input[type="checkbox"]')]) box.replaceWith(doc.createTextNode(box.checked || box.hasAttribute('checked') ? '☑ ' : '☐ '));
  flattenDeepLists(root);
}

/** DOCX has nine list levels; the converter refuses a deeper list rather than clamping it. */
export const MAX_LIST_LEVELS = 9;

/**
 * A list nested past the ninth level is lifted into the list above it, its
 * items following the item that held them, until nothing is deeper than DOCX
 * allows. The text keeps its order; only the deepest indentation is lost.
 */
export function flattenDeepLists(root) {
  const depth = (list) => { let n = 0; for (let item = list.parentElement?.closest('li'); item; item = item.parentElement?.closest('li')) n++; return n; };
  for (let guard = 0; guard < 100; guard++) {
    const deep = [...root.querySelectorAll('ul, ol')].filter((list) => depth(list) >= MAX_LIST_LEVELS);
    if (!deep.length) return;
    for (const list of deep) {
      const item = list.parentElement?.closest('li');
      if (!item?.parentElement) continue;
      item.after(...[...list.children].filter((child) => child.tagName === 'LI'));
      list.remove();
    }
  }
}

/** A line YAML front matter is made of: a key, an indented continuation, a list item, or a comment. */
const YAML_LINE = /^(?:[\p{L}_][^:]{0,80}:(?:\s|$)|\s+\S|- |#)/u;

/**
 * Front matter (title, author…) is metadata, not a horizontal rule and a
 * heading; it is dropped only when the block between the fences reads as
 * YAML, so a document that merely opens with a rule keeps its first section.
 */
function withoutFrontMatter(text) {
  const open = /^\uFEFF?---[ \t]*\r?\n/.exec(text);
  if (!open) return text;
  const line = /([^\n]*)(\r?\n|$)/g;
  line.lastIndex = open[0].length;
  for (let count = 0; count < 200; count++) {
    const m = line.exec(text);
    if (!m) break;
    const body = m[1].replace(/\r$/, '');
    if (/^(?:---|\.\.\.)[ \t]*$/.test(body)) return text.slice(line.lastIndex);
    if (!body.trim() || !YAML_LINE.test(body) || m[2] === '') break;
  }
  return text;
}

/** Markdown the converter reads poorly, rewritten: YAML front matter goes, and task list boxes become their characters. */
export function normalizeMarkdown(text) {
  const lines = withoutFrontMatter(String(text ?? '')).split('\n');
  // "- [ ] task" / "- [x] done": the state would otherwise be dropped with the box. A fenced
  // code block showing the syntax is left as written.
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length && /^ {0,3}(?:`{3,}|~{3,})[ \t]*\r?$/.test(lines[i])) fence = null;
      continue;
    }
    if (opening) { fence = opening[1]; continue; }
    lines[i] = lines[i].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](?=\s)/, (m, prefix, state) => `${prefix}${state === ' ' ? '☐' : '☑'}`);
  }
  return lines.join('\n');
}
