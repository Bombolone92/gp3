/**
 * Formatting edits for the composer's textarea, as pure functions over
 * `{ value, start, end }` (the text and its selection) so the toolbar and
 * the keyboard shortcuts share one implementation and it can be tested
 * without a DOM. Every edit toggles: applying it to text that already
 * carries the mark removes the mark instead.
 *
 * The marks are the ones formatMessage understands: **bold**, _italic_,
 * ~strike~, `code`, ``` fenced blocks ```, and "> " quotes.
 */

export const FORMATS = {
  bold: { label: 'Bold', mark: '**', key: 'b' },
  italic: { label: 'Italic', mark: '_', key: 'i' },
  strike: { label: 'Strikethrough', mark: '~', key: 'x', shift: true },
  code: { label: 'Code', mark: '`', key: 'c', shift: true },
  codeBlock: { label: 'Code block', key: 'c', shift: true, alt: true },
  quote: { label: 'Quote', key: '9', shift: true },
  link: { label: 'Link', key: 'u', shift: true },
};

/** Wrap the selection in `mark` on both sides, or unwrap it when it already is. */
export function toggleWrap({ value, start, end }, mark) {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  const n = mark.length;
  // The marks draw within one line (see lib/format.js: **, _, ~ and ` never
  // run across a line break), so a selection over several lines is wrapped
  // line by line, blank lines and a line's indentation left as they are, and
  // unwrapped the same way once every line carries the marks. Wrapped whole,
  // the marks stood at either end of a run the renderer never draws, and the
  // message posted with them as typed.
  if (sel.includes('\n')) {
    const parts = sel.split('\n').map((l) => /^(\s*)(.*?)(\s*)$/.exec(l));
    const words = parts.filter((p) => p[2]);
    const marked = (t) => t.length >= 2 * n && t.startsWith(mark) && t.endsWith(mark);
    const unwrap = words.length > 0 && words.every((p) => marked(p[2]));
    const out = parts.map((p) => (!p[2] ? p[0] : p[1] + (unwrap ? p[2].slice(n, p[2].length - n) : mark + p[2] + mark) + p[3])).join('\n');
    return { value: before + out + after, start, end: start + out.length };
  }
  // The selection includes the marks: **bold** -> bold
  if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(n, sel.length - n);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  // The marks sit just outside the selection: **|bold|** -> |bold|
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return { value: before.slice(0, -n) + sel + after.slice(n), start: start - n, end: end - n };
  }
  return { value: before + mark + sel + mark + after, start: start + n, end: end + n };
}

/**
 * Add "> " to every line the selection touches, or remove it from all of
 * them. A selection that ends right after a line break (whole lines taken
 * with Shift+Down, a drag to the start of the next line, a triple-click)
 * stops before the line its end stands on, as toggleWrap reads such a
 * selection: taken as touching that line, Quote put a "> " on a line
 * nobody had selected, an empty one as often as not.
 *
 * The first line begins at the start of the text, whatever it holds: asked
 * for the last line break before the first character, lastIndexOf reads a
 * negative position as the first one and found the break that IS the first
 * character when the text opened with an empty line, so a Quote from there
 * put its arrow on a line of its own between that empty line and the rest,
 * and the text gained a blank line nobody had typed.
 */
export function toggleQuote({ value, start, end }) {
  const lineStart = start > 0 ? value.lastIndexOf('\n', start - 1) + 1 : 0;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nextNl = value.indexOf('\n', last);
  const lineEnd = nextNl === -1 ? value.length : nextNl;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const quoted = lines.every((l) => /^> ?/.test(l));
  const next = lines.map((l) => (quoted ? l.replace(/^> ?/, '') : `> ${l}`));
  const block = next.join('\n');
  const delta = block.length - (lineEnd - lineStart);
  const firstDelta = next[0].length - lines[0].length;
  return {
    value: value.slice(0, lineStart) + block + value.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta),
    end: Math.max(lineStart, end + delta),
  };
}

/** Put the selection in a fenced block on its own lines, or lift it out of one. */
export function toggleCodeBlock({ value, start, end }) {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(sel);
  if (fenced) {
    return { value: before + fenced[1] + after, start, end: start + fenced[1].length };
  }
  const outside = /```[^\n]*\n$/.exec(before);
  if (outside && after.startsWith('\n```')) {
    const b = before.slice(0, before.length - outside[0].length);
    return { value: b + sel + after.slice(4), start: b.length, end: b.length + sel.length };
  }
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const tail = after && !after.startsWith('\n') ? '\n' : '';
  const open = `${lead}\`\`\`\n`;
  return {
    value: `${before}${open}${sel}\n\`\`\`${tail}${after}`,
    start: start + open.length,
    end: start + open.length + sel.length,
  };
}

/**
 * Insert a link. The formatter links bare URLs, so a URL replaces the
 * selection (or lands at the cursor) with a space around it when the
 * neighbours are not already spaces.
 */
export function insertLink({ value, start, end }, url) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const tail = after && !/^\s/.test(after) ? ' ' : '';
  const text = `${lead}${url}${tail}`;
  return { value: before + text + after, start: start + lead.length, end: start + lead.length + url.length };
}

export function applyFormat(state, kind, extra) {
  switch (kind) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
      return toggleWrap(state, FORMATS[kind].mark);
    case 'quote':
      return toggleQuote(state);
    case 'codeBlock':
      return toggleCodeBlock(state);
    case 'link':
      return extra ? insertLink(state, extra) : state;
    default:
      return state;
  }
}

/** Which format a keydown asks for, or null. Cmd on Mac, Ctrl elsewhere. */
export function formatForKey(e) {
  if (!(e.metaKey || e.ctrlKey)) return null;
  // Shift changes what a digit key reports as `key` ("(" for 9), so digits
  // are matched by physical key.
  const digit = /^Digit(\d)$/.exec(e.code || '');
  // So does Option on a Mac for letters (Option+Shift+C reports "Ç"): with
  // Alt held, a letter is matched by physical key too.
  const letter = e.altKey ? /^Key([A-Z])$/.exec(e.code || '') : null;
  const key = digit ? digit[1] : letter ? letter[1].toLowerCase() : String(e.key || '').toLowerCase();
  for (const [kind, f] of Object.entries(FORMATS)) {
    if (f.key !== key) continue;
    if (!!f.shift !== !!e.shiftKey) continue;
    if (!!f.alt !== !!e.altKey) continue;
    return kind;
  }
  return null;
}
