/**
 * Footnotes and endnotes in HTML and Markdown exports. The engine's
 * projections stand in for each note reference with a placeholder
 * ("[footnote 1]") and leave the note's own text out, so a downloaded or
 * published page lost every note. The placeholder becomes the reference
 * number linked to its note, and the notes follow the text: footnotes, then
 * endnotes, each in document order. Markdown uses footnote syntax
 * (`[^1]` and `[^1]: ...`), which GitHub and most renderers show as notes.
 */

const REFERENCE = /<span data-document-placeholder="note">\[(footnote|endnote) ([^\]<]+)\]<\/span>/g;
// The note's own reference mark, which the projection cannot represent.
const MARK = '<span data-document-placeholder="unsupported">\\[unsupported content\\]</span>\\s*';
const HTML_MARK = new RegExp(`^(<(?:p|h[1-6])(?:\\s[^>]*)?>)${MARK}`);
const MARKDOWN_MARK = new RegExp(`^((?:#{1,6} |> |[-*+] |\\d+\\. )?)${MARK}`);
// Pictures and unresolvable links inside a note are not restored the way the body's are; their placeholders are not shown.
const OTHER_PLACEHOLDERS = /<span data-document-placeholder="(?:image|hyperlink-unresolved)">\[[^\]]*\]<\/span>/g;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Every note in document order; the list is paged. */
async function listNotes(api) {
  const items = [];
  let offset = 0;
  for (;;) {
    const result = await api.footnotes.list({ limit: 200, offset });
    const page = Array.isArray(result?.items) ? result.items : [];
    items.push(...page);
    offset += page.length;
    if (!page.length || offset >= (Number(result?.total) || 0)) break;
  }
  return items;
}

/**
 * The note each reference stands for, in reference order: the k-th reference
 * of a kind is the k-th note of that kind, the one showing its number when
 * they differ. Null where no note answers.
 */
export async function matchNotes(api, refs) {
  const notes = await listNotes(api);
  const remaining = { footnote: notes.filter((n) => n.type === 'footnote'), endnote: notes.filter((n) => n.type === 'endnote') };
  return refs.map(({ type, number }) => {
    const queue = remaining[type] || [];
    const index = Math.max(0, queue.findIndex((n) => String(n.displayNumber) === number));
    const note = queue.splice(index, 1)[0];
    return note ? { note, type, number } : null;
  });
}

/** The note's paragraphs in the export format, from its story; its plain text when the story cannot be projected. */
export async function noteBody(api, note, format) {
  const project = format === 'html' ? api.projectHtml : api.projectMarkdown;
  try {
    const result = project && await project.call(api, { in: { kind: 'story', storyType: note.type, noteId: note.noteId } });
    // A projection that answers nothing at all did not project the story; one that answers only its
    // reference mark did, for a note whose every word is hidden, and its plain text would show those words.
    if (result && result.status !== 'failed' && typeof result.content === 'string' && result.content) {
      let body = (format === 'html' ? result.content.replace(HTML_MARK, '$1') : result.content.replace(MARKDOWN_MARK, '$1')).replace(OTHER_PLACEHOLDERS, '');
      // A list inside a note is rewritten here, before the note's lines are indented under its label.
      if (format !== 'html') body = (await import('./export-markdown-lists.js')).markdownLists(body);
      return body;
    }
  } catch { /* the plain text below stands in */ }
  const text = escapeHtml(String(note.content ?? '').trim());
  return format === 'html' ? `<p>${text}</p>` : text;
}

/**
 * The export with its note references numbered and linked, and the notes
 * appended. `content` is the body projection with pictures restored. The
 * k-th reference of a kind is the k-th note of that kind; a reference no
 * note answers to keeps the engine's placeholder.
 */
export async function appendNotes(api, format, content) {
  if (typeof content !== 'string' || !api?.footnotes?.list || !new RegExp(REFERENCE.source).test(content)) return content;
  // A reference that ends a link's text steps outside the link, so the reference is not a link inside a link;
  // a link that held nothing else goes, and in Markdown the reference leaves the link's brackets.
  content = content.replace(/(<span data-document-placeholder="note">\[[^\]<]+\]<\/span>)(<\/a>)/g, '$2$1').replace(/<a\b[^>]*><\/a>/g, '');
  if (format !== 'html') content = content.replace(/\[(<span data-document-placeholder="note">\[[^\]<]+\]<\/span>)\]\([^)]*\)/g, '$1');
  // Markdown has no footnote syntax inside a table, which the projection writes as raw HTML: a reference
  // in a cell makes every reference and the notes themselves take their HTML form, which Markdown renders.
  const tables = format === 'html' ? [] : [...content.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => [m.index, m.index + m[0].length]);
  const asHtml = format === 'html' || [...content.matchAll(REFERENCE)].some((m) => tables.some(([start, end]) => m.index >= start && m.index < end));
  const matched = await matchNotes(api, [...content.matchAll(REFERENCE)].map(([, type, number]) => ({ type, number })));
  const used = [];
  let next = 0;
  const replaced = content.replace(REFERENCE, (match, type, number) => {
    const found = matched[next++];
    if (!found) return match;
    const ordinal = used.filter((entry) => entry.type === type).length + 1;
    const entry = { ...found, id: `${type}-${ordinal}`, label: `${type === 'endnote' ? 'e' : ''}${ordinal}` };
    used.push(entry);
    return asHtml ? `<sup class="note-ref" id="${entry.id}-ref"><a href="#${entry.id}">${escapeHtml(number)}</a></sup>` : `[^${entry.label}]`;
  });
  if (!used.length) return content;
  const bodies = await Promise.all(used.map((entry) => noteBody(api, entry.note, asHtml ? 'html' : format)));
  const ordered = ['footnote', 'endnote'].flatMap((type) => used.map((entry, i) => [entry, bodies[i]]).filter(([entry]) => entry.type === type));
  if (asHtml) {
    const sections = ['footnote', 'endnote'].map((type) => {
      const own = ordered.filter(([entry]) => entry.type === type);
      if (!own.length) return '';
      const items = own.map(([entry, body]) => {
        const number = `<a class="note-number" href="#${entry.id}-ref" role="doc-backlink">${escapeHtml(entry.number)}</a>`;
        const text = /^<(?:p|h[1-6])(?:\s[^>]*)?>/.test(body) ? body.replace(/^<(p|h[1-6])(\s[^>]*)?>/, `<$1$2>${number} `) : `<p>${number}</p>${body}`;
        return `<div class="footnote" id="${entry.id}" role="doc-${type}">${text}</div>`;
      });
      return `<section class="footnotes" role="doc-${type}s"><hr>${items.join('')}</section>`;
    });
    // In Markdown the sections stand as an HTML block of their own, after a blank line.
    return format === 'html' ? replaced + sections.join('') : `${replaced.replace(/\s+$/, '')}\n\n${sections.join('')}\n`;
  }
  const definitions = ordered.map(([entry, body]) => {
    // Every line after the first is indented under the label, blank lines between paragraphs kept.
    const lines = body.trim().split('\n');
    return `[^${entry.label}]: ${lines[0]}${lines.slice(1).map((line) => (line.trim() ? `\n    ${line}` : '\n')).join('')}`;
  });
  return `${replaced.replace(/\s+$/, '')}\n\n${definitions.join('\n\n')}\n`;
}
