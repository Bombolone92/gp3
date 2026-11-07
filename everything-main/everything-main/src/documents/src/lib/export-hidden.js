import { unzipSync, strFromU8 } from 'fflate';
import { bytesFromBase64 } from './bytes.js';
import { textOffset } from './export-hyperlinks.js';

/**
 * Hidden text in HTML and Markdown exports. Text with the "hidden" effect is
 * neither shown nor printed, and a downloaded or published page must not
 * carry it either, but the engine's projections write it like any other text
 * and report no formatting. The hidden runs are read from the document's own
 * XML with their offsets in the projection's coordinates, then cut out of the
 * projection through its source map. A cut is made only where the projected
 * text matches the hidden run exactly, so a miscounted offset leaves text in
 * place rather than removing the wrong text.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
// What each run child is worth in the projection's source coordinates (UTF-16 units of text; one for a
// tab, break or note reference; nothing for symbols, hyphens, absolute tabs, drawings and field machinery).
const ONE = { tab: '\t', br: '\n', cr: '\n', footnoteReference: '￼', endnoteReference: '￼' };
const CONTAINERS = new Set(['hyperlink', 'ins', 'del', 'moveTo', 'moveFrom', 'smartTag', 'sdt', 'sdtContent', 'customXml', 'fldSimple', 'dir', 'bdo']);

const isW = (node, name) => node?.namespaceURI === W && node.localName === name;
const yes = (value) => !/^(0|false|off)$/i.test(value || '');

/** What a set of run properties says about hiding: true, false (an explicit override), or null when it says nothing. */
function vanishIn(node) {
  const props = node && [...node.children].find((child) => isW(child, 'rPr'));
  const vanish = props && [...props.children].find((child) => isW(child, 'vanish'));
  return vanish ? yes(vanish.getAttributeNS(W, 'val')) : null;
}

/**
 * Whether a run is hidden: by its own properties, else by its character
 * style (through the styles it is based on), else by its paragraph's style,
 * else by the document defaults. Without `context`, only the run's own
 * properties count.
 */
export function hiddenRun(run, context = null) {
  const own = vanishIn(run);
  if (own != null) return own;
  if (!context) return false;
  const props = [...run.children].find((child) => isW(child, 'rPr'));
  const styleId = props && [...props.children].find((child) => isW(child, 'rStyle'))?.getAttributeNS(W, 'val');
  const fromStyle = styleId ? context.styles.effective(styleId) : null;
  return fromStyle ?? context.paragraphHidden;
}

/** The styles part read for hiding: each style's effective answer through its basedOn chain, and the document defaults. */
function hiddenStyles(source) {
  const none = { effective: () => null, defaults: false, any: false };
  if (!source || !/vanish/.test(source)) return none;
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) return none;
  const styles = new Map();
  for (const style of document.getElementsByTagNameNS(W, 'style')) styles.set(style.getAttributeNS(W, 'styleId'), style);
  const defaults = [...document.getElementsByTagNameNS(W, 'rPrDefault')].some((node) => vanishIn(node) === true);
  const resolved = new Map();
  const effective = (id, seen = new Set()) => {
    if (resolved.has(id)) return resolved.get(id);
    const style = styles.get(id);
    if (!style || seen.has(id)) return null;
    seen.add(id);
    const own = vanishIn(style);
    const base = [...style.children].find((child) => isW(child, 'basedOn'))?.getAttributeNS(W, 'val');
    const value = own != null ? own : base ? effective(base, seen) : null;
    resolved.set(id, value);
    return value;
  };
  return { effective, defaults, any: defaults || [...styles.keys()].some((id) => effective(id) === true) };
}

function walk(node, state, blockId, hidden, context) {
  for (const child of node.children) {
    if (child.namespaceURI !== W) continue;
    if (child.localName === 'r') {
      const start = state.offset, concealed = hiddenRun(child, context);
      let text = '';
      for (const part of child.children) {
        if (part.namespaceURI !== W) continue;
        if (part.localName === 't' || part.localName === 'delText') { text += part.textContent; state.offset += part.textContent.length; }
        else if (ONE[part.localName]) {
          // A note reference is projected as a placeholder, found again by its place among the paragraph's references.
          if (part.localName.endsWith('noteReference')) { if (concealed) hidden.push({ blockId, start: state.offset, end: state.offset + 1, text: ONE[part.localName], noteRef: state.noteRefs }); state.noteRefs += 1; }
          text += ONE[part.localName]; state.offset += 1;
        }
      }
      if (state.offset > start && concealed) hidden.push({ blockId, start, end: state.offset, text });
    } else if (CONTAINERS.has(child.localName)) walk(child, state, blockId, hidden, context);
  }
}

/**
 * The hidden runs of the document's paragraphs and notes: block ID, offsets
 * in the projection's source coordinates (which count deleted text), and
 * text. Reads the document as the engine writes it; empty when nothing is
 * hidden.
 */
const PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];
const STYLES = 'word/styles.xml';
export async function hiddenRuns(api) {
  if (!api?.export?.toDocx) return [];
  const exported = await api.export.toDocx({});
  if (typeof exported?.contentBase64 !== 'string') return [];
  const files = unzipSync(bytesFromBase64(exported.contentBase64), { filter: (file) => PARTS.includes(file.name) || file.name === STYLES });
  const hidden = [];
  // Text is also hidden through a style ("Hidden Text" in a template's styles pane), which is neither shown nor printed.
  const styles = hiddenStyles(files[STYLES] ? strFromU8(files[STYLES]) : '');
  // Notes are projected from their own parts, whose paragraphs carry ids of their own.
  for (const name of PARTS) {
    const source = files[name] ? strFromU8(files[name]) : '';
    if (!source || (!/vanish/.test(source) && !styles.any)) continue;
    const document = new DOMParser().parseFromString(source, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) continue;
    for (const paragraph of document.getElementsByTagNameNS(W, 'p')) {
      const id = paragraph.getAttributeNS(W14, 'paraId');
      if (!id) continue;
      const pPr = [...paragraph.children].find((child) => isW(child, 'pPr'));
      const pStyle = pPr && [...pPr.children].find((child) => isW(child, 'pStyle'))?.getAttributeNS(W, 'val');
      const paragraphHidden = (pStyle ? styles.effective(pStyle) : null) ?? styles.defaults;
      walk(paragraph, { offset: 0, noteRefs: 0 }, id, hidden, { styles, paragraphHidden });
    }
  }
  return hidden;
}

/** Projected text back to source text: entities, and Markdown's backslash escapes. */
function decode(text, markdown) {
  const unescaped = markdown ? text.replace(/\\([!-/:-@[-`{-~])/g, '$1') : text;
  // Parsed as a document of its own, leading whitespace (a tab entity, "&#9;") would be dropped: a letter in front keeps it.
  return unescaped.includes('&') ? new DOMParser().parseFromString(`<p>x${unescaped}`, 'text/html').body.textContent.slice(1) : unescaped;
}

/**
 * Replacements (empty, at output offsets) that take the hidden runs out of
 * a projection. A paragraph left with nothing but its tags goes as a whole.
 */
export function hiddenCuts(projection, runs) {
  if (!runs.length || !projection?.sourceMap?.entries || typeof projection.content !== 'string') return [];
  const markdown = projection.format === 'markdown';
  const content = projection.content;
  const byBlock = new Map();
  for (const entry of projection.sourceMap.entries) {
    if (!byBlock.has(entry.blockId)) byBlock.set(entry.blockId, { text: [], other: [] });
    const block = byBlock.get(entry.blockId);
    if (entry.kind === 'text' && entry.source?.segments?.length === 1 && entry.source.segments[0].blockId === entry.blockId) block.text.push(entry);
    else block.other.push(entry);
  }
  const cuts = [];
  const NOTE_OPEN = '<span data-document-placeholder="note">', CLOSE = '</span>';
  for (const run of runs) {
    const block = byBlock.get(run.blockId);
    if (run.noteRef != null) {
      // The reference's placeholder (span and all) goes; with no reference left, the note is not appended either.
      const marks = (block?.other || []).filter((entry) => entry.kind === 'synthetic' && /^\[(footnote|endnote) [^\]]+\]$/.test(content.slice(entry.output.start, entry.output.end))
        && content.slice(entry.output.start - NOTE_OPEN.length, entry.output.start) === NOTE_OPEN && content.startsWith(CLOSE, entry.output.end)).sort((a, b) => a.output.start - b.output.start);
      const mark = marks[run.noteRef];
      if (mark) cuts.push({ start: mark.output.start - NOTE_OPEN.length, end: mark.output.end + CLOSE.length, html: '', entry: mark, mark: true });
      continue;
    }
    const entries = (block?.text || []).filter((entry) => entry.source.segments[0].range.start < run.end && entry.source.segments[0].range.end > run.start);
    const parts = [];
    for (const entry of entries) {
      const { start: a, end: b } = entry.source.segments[0].range;
      const text = content.slice(entry.output.start, entry.output.end);
      const from = Math.max(run.start, a) - a, to = Math.min(run.end, b) - a;
      const expected = run.text.slice(Math.max(run.start, a) - run.start, Math.min(run.end, b) - run.start);
      let x = 0, y = text.length;
      if (!(expected === '\n' && from === 0 && to === b - a && (text === '<br>' || text === '\\\n'))) {
        x = from === 0 ? 0 : textOffset(text, from, markdown);
        y = to === b - a ? text.length : textOffset(text, to, markdown);
        if (x == null || y == null || decode(text.slice(x, y), markdown) !== expected) { parts.length = 0; break; }
      }
      parts.push({ entry, start: entry.output.start + x, end: entry.output.start + y, source: { start: a + from, end: a + to } });
    }
    for (const part of parts) cuts.push({ start: part.start, end: part.end, html: '', entry: part.entry, source: part.source });
  }
  // Adjacent cuts are one hidden run's: the projection splits a run's text at every escaped character.
  const chains = [];
  for (const cut of [...cuts].filter((c) => !c.mark).sort((a, b) => a.start - b.start)) {
    const chain = chains.at(-1);
    if (chain && chain.at(-1).end === cut.start) chain.push(cut); else chains.push([cut]);
  }
  for (const chain of chains) {
    const first = chain[0], last = chain.at(-1);
    if (markdown) {
      // Markdown wraps a hidden run's emphasis around it: a cut that leaves "****" behind takes the markers too.
      const opening = /([*_~`]+)$/.exec(content.slice(Math.max(0, first.start - 4), first.start)), closing = /^([*_~`]+)/.exec(content.slice(last.end, last.end + 4));
      if (opening && closing && opening[1] === closing[1]) { first.start -= opening[1].length; last.end += closing[1].length; }
      // A link whose whole text was hidden would be left as "[](address)": the address goes with it.
      const link = content[first.start - 1] === '[' && /^\]\([^)\n]*\)/.exec(content.slice(last.end, last.end + 2100));
      if (link) { first.start -= 1; last.end += link[0].length; }
      continue;
    }
    // HTML: a formatting wrapper (or a link) left empty by the cut goes with it, inside out.
    for (;;) {
      const open = /<(strong|em|u|s|del|code|sup|sub|mark|span|a)\b[^>]*>$/.exec(content.slice(Math.max(0, first.start - 2200), first.start));
      const close = open && new RegExp(`^</${open[1]}>`).exec(content.slice(last.end, last.end + 12));
      if (!open || !close) break;
      first.start -= open[0].length;
      last.end += close[0].length;
    }
  }
  // An entry is covered when its cuts, together, span all of it.
  const covered = (entry) => {
    let at = entry.output.start;
    for (const cut of cuts.filter((c) => c.entry === entry).sort((a, b) => a.start - b.start)) { if (cut.start > at) return false; at = Math.max(at, cut.end); }
    return at >= entry.output.end;
  };
  // A paragraph (or heading) whose every word was hidden leaves no empty block behind.
  for (const block of byBlock.values()) {
    if (!block.text.length || block.other.length || !block.text.every(covered)) continue;
    const own = cuts.filter((cut) => cut.entry && block.text.includes(cut.entry));
    const first = Math.min(...own.map((cut) => cut.start)), last = Math.max(...own.map((cut) => cut.end));
    const before = content.slice(0, first), after = content.slice(last);
    if (markdown) {
      // The whole line goes when nothing but markers (a heading's "#", emphasis) would remain of it.
      const lineStart = before.lastIndexOf('\n\n') === -1 ? 0 : before.lastIndexOf('\n\n') + 2;
      const nextBreak = content.indexOf('\n\n', last), lineEnd = nextBreak === -1 ? content.length : nextBreak;
      let residual = '', at = lineStart;
      for (const cut of [...own].sort((a, b) => a.start - b.start)) { residual += content.slice(at, Math.max(at, cut.start)); at = Math.max(at, cut.end); }
      residual += content.slice(at, lineEnd);
      if (!/^[\s#>*_~`]*$/.test(residual)) continue;
      for (const cut of own) cuts.splice(cuts.indexOf(cut), 1);
      cuts.push({ start: lineStart, end: nextBreak === -1 ? lineEnd : lineEnd + 2, html: '', whole: true });
      continue;
    }
    const open = /(<(p|h[1-6])(?:\s[^>]*)?>)(?:<[^>]+>)*$/.exec(before), close = open && new RegExp(`^(?:<[^>]+>)*</${open[2]}>`).exec(after);
    const sorted = [...own].sort((a, b) => a.start - b.start);
    const between = sorted.slice(1).some((cut, i) => !/^(?:<[^>]+>)*$/.test(content.slice(sorted[i].end, cut.start)));
    if (!open || !close || between) continue;
    for (const cut of own) cuts.splice(cuts.indexOf(cut), 1);
    cuts.push({ start: open.index, end: last + close[0].length, html: '', whole: true });
  }
  return cuts.sort((a, b) => a.start - b.start);
}

/**
 * The projection with its hidden runs cut out: the content without them,
 * and a source map whose entries follow (an entry cut in the middle splits
 * in two, each with its own share of the source; entries cut away go).
 * Every later reading of the projection, for links, pictures or notes, then
 * sees a document without hidden text.
 */
export function omitHidden(projection, runs) {
  if (!runs?.length || projection?.status === 'failed' || typeof projection?.content !== 'string' || !projection.sourceMap?.entries) return projection;
  const cuts = hiddenCuts(projection, runs);
  if (!cuts.length) return projection;
  let content = projection.content;
  for (const cut of [...cuts].reverse()) content = content.slice(0, cut.start) + content.slice(cut.end);
  const shift = (offset) => {
    let removed = 0;
    for (const cut of cuts) {
      if (cut.end <= offset) removed += cut.end - cut.start;
      else if (cut.start < offset) return cut.start - removed;
      else break;
    }
    return offset - removed;
  };
  const entries = projection.sourceMap.entries.flatMap((entry) => {
    if (cuts.some((cut) => cut.whole && entry.output.start >= cut.start && entry.output.end <= cut.end)) return [];
    const own = cuts.filter((cut) => cut.entry === entry).sort((a, b) => a.start - b.start);
    if (!own.length) return [{ ...entry, output: { start: shift(entry.output.start), end: shift(entry.output.end) } }];
    // A hidden note reference takes its placeholder whole; the synthetic entry has no source to split.
    if (own.some((cut) => cut.mark) || !entry.source?.segments?.length) return [];
    // The pieces of the entry between its cuts, each keeping the source it still covers.
    const segment = entry.source.segments[0];
    const pieces = [];
    let at = entry.output.start, from = segment.range.start;
    for (const cut of [...own, { start: entry.output.end, end: entry.output.end, source: { start: segment.range.end, end: segment.range.end } }]) {
      if (cut.start > at) pieces.push({ ...entry, output: { start: shift(at), end: shift(cut.start) }, source: { ...entry.source, segments: [{ ...segment, range: { start: from, end: cut.source.start } }] } });
      at = cut.end; from = cut.source.end;
    }
    return pieces;
  });
  return { ...projection, content, sourceMap: { ...projection.sourceMap, entries } };
}

/**
 * The Document API with its HTML and Markdown projections free of the
 * hidden `runs`, for an export pipeline that projects more than once (the
 * body, a link's scope, a note's story). The same object otherwise.
 */
export function withoutHidden(api, runs) {
  if (!api) return api;
  // Nothing hidden: the projections are read as they are, and nobody reads the document for hidden text again.
  if (!runs?.length) return { ...api, hiddenRunsApplied: true };
  // Cutting needs the source map, whether or not the caller asked for one.
  const project = (name) => (api[name] ? async (input) => omitHidden(await api[name].call(api, { ...input, includeSourceMap: true }), runs) : api[name]);
  return { ...api, projectHtml: project('projectHtml'), projectMarkdown: project('projectMarkdown'), hiddenRunsApplied: true };
}

/**
 * The cuts that take a document's hidden text out of `projection`, from the
 * document as the engine writes it. Fails the export when the document
 * changed in between, like the picture export does.
 */
export async function hiddenReplacements(api, projection) {
  const runs = await hiddenRuns(api);
  if (!runs.length) return [];
  if (api.info && String((await api.info({})).revision) !== String(projection.evaluatedRevision)) throw new Error('The document changed while exporting. Try again');
  return hiddenCuts(projection, runs).map(({ start, end }) => ({ start, end, html: '' }));
}
