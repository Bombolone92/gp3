/**
 * Change the case of selected text without disturbing its formatting.
 *
 * The engine's `replace` keeps the formatting of the first run it touches,
 * so text is replaced one run at a time (a run being one stretch of identical
 * formatting) and every character maps to exactly one character, which keeps
 * each run's extent. Run boundaries come from the painted page, where every
 * text span is one run and carries its document position; paragraphs that
 * are not painted (scrolled far away) are left alone and reported. The
 * boundaries of words and sentences are decided over the whole selection first, so a word
 * split across two runs is still one word.
 */

import { endsWithAbbreviation } from './autocorrect.js';

export const CASE_MODES = [
  { id: 'lower', label: 'lowercase' },
  { id: 'upper', label: 'UPPERCASE' },
  { id: 'title', label: 'Title Case' },
  { id: 'sentence', label: 'Sentence case' },
];

const isLetter = (c) => /\p{L}/u.test(c);
// A combining mark (an accent written after its letter in decomposed text) is part of the letter before it.
const isMark = (c) => /\p{M}/u.test(c);
const isSpace = (c) => /\s/u.test(c);
const upper = (c) => { const u = c.toUpperCase(); return u.length === c.length ? u : c; };
const lower = (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; };

/**
 * `text` with its case changed, one character to one character (letters
 * whose case form has a different length, like ß, are left alone).
 */
export function changeCase(text, mode) {
  const chars = Array.from(String(text ?? ''));
  if (mode === 'upper') return chars.map(upper).join('');
  if (mode === 'lower') return chars.map(lower).join('');
  if (mode === 'title') {
    let startOfWord = true;
    return chars.map((c) => {
      if (isLetter(c) || /\p{N}/u.test(c)) { const out = startOfWord ? upper(c) : lower(c); startOfWord = false; return out; }
      if (isMark(c)) return c;
      // Apostrophes keep a word going ("don't"); anything else starts a new one.
      if (c !== '’' && c !== "'") startOfWord = true;
      return c;
    }).join('');
  }
  if (mode === 'sentence') {
    // A period, question or exclamation mark ends a sentence only once a space follows it
    // (closing quotes and brackets may come first): "example.com" and "index.html" go on,
    // and so does the word after "e.g." or "Dr.".
    let startOfSentence = true, ended = false;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (isLetter(c)) { chars[i] = startOfSentence ? upper(c) : lower(c); startOfSentence = false; ended = false; continue; }
      if (isMark(c)) continue;
      if (/[.!?…]/.test(c)) ended = true;
      else if (isSpace(c)) {
        // Inspect only a bounded tail of the converted characters. Slicing a
        // growing concatenated string flattens it at every sentence boundary,
        // repeatedly copying the whole paragraph even for a 32-unit slice.
        if (ended && !endsWithAbbreviation(chars.slice(Math.max(0, i - 31), i + 1).join(''))) startOfSentence = true;
        ended = false;
      }
      else if (/["'“”‘’)\]]/.test(c)) { /* a closing quote or bracket keeps a pending end */ }
      else if (!/[(\[]/.test(c)) { startOfSentence = false; ended = false; }
    }
    return chars.join('');
  }
  return String(text ?? '');
}

/**
 * The painted fragments of a paragraph with their document positions. A
 * paragraph that runs across pages paints as several fragments, and only
 * the first starts where the paragraph does, so `base` (the paragraph's own
 * start) is the earliest fragment's start.
 */
function paintedFragments(host, blockId) {
  const frags = [...(host?.querySelectorAll?.('.document-fragment') || [])].filter((f) => f.dataset.sourceNodeId === blockId);
  const extents = frags.map((frag) => [Number.parseInt(frag.dataset.pmStart, 10), Number.parseInt(frag.dataset.pmEnd, 10)]).filter(([a]) => Number.isFinite(a));
  return { frags, extents, base: Math.min(...extents.map(([a]) => a)) };
}

/**
 * The parts of a paragraph's runs that fall inside a text range, read from
 * the painted page: `{ start, end, text }` in paragraph offsets, in order
 * (`withSize` adds each run's painted font size in points).
 * `text` is the paragraph's text; a span that does not match it is dropped
 * (the safe failure is to leave that stretch alone). Empty when the paragraph
 * is not painted.
 */
export function runPieces(host, blockId, range, text, { withSize = false } = {}) {
  const { frags, base } = paintedFragments(host, blockId);
  const pieces = [];
  if (!Number.isFinite(base)) return pieces;
  for (const frag of frags) {
    for (const span of frag.querySelectorAll('.document-text-run')) {
      const from = Number.parseInt(span.dataset.pmStart, 10) - base;
      const to = Number.parseInt(span.dataset.pmEnd, 10) - base;
      if (!(to > from) || from < 0) continue;
      if (text.slice(from, to) !== span.textContent) continue;
      const start = Math.max(from, range.start);
      const end = Math.min(to, range.end);
      if (!(end > start)) continue;
      const piece = { start, end, text: text.slice(start, end) };
      if (withSize) {
        // The painted size in points; the page's computed styles are not scaled by the zoom. A
        // superscript or subscript (an inline vertical shift) is painted at 0.65 of its own size.
        const shift = Number.parseFloat(span.style?.verticalAlign || '');
        const raised = /^(sub|super|text-top|text-bottom)/.test(span.style?.verticalAlign || '') || (Number.isFinite(shift) && shift !== 0);
        piece.size = Math.round(Number.parseFloat(getComputedStyle(span).fontSize) * 0.75 / (raised ? 0.65 : 1) * 2) / 2;
      }
      pieces.push(piece);
    }
  }
  pieces.sort((a, b) => a.start - b.start);
  // Overlaps (a span painted twice) collapse to the first.
  return pieces.filter((p, i) => i === 0 || p.start >= pieces[i - 1].end);
}

/**
 * Whether the painted fragments of a paragraph reach across the whole range;
 * when they do not, the rest sits on a page that is not painted yet. A
 * fragment without an end is taken to reach the end of `text`.
 */
export function paintedAcross(host, blockId, range, text) {
  const { extents, base } = paintedFragments(host, blockId);
  if (!Number.isFinite(base)) return false;
  let reached = range.start;
  for (const [a, b] of extents.map(([a, b]) => [a - base, Number.isFinite(b) ? b - base : text.length]).sort((x, y) => x[0] - y[0])) {
    if (a > reached) break;
    reached = Math.max(reached, b);
  }
  return reached >= range.end;
}

/** The text of a paragraph or heading from getNodeById; null when it holds more than runs. */
export function paragraphText(node) {
  const content = node?.node?.paragraph || node?.node?.heading;
  const inlines = content?.inlines || [];
  if (inlines.some((i) => i?.kind !== 'run')) return null;
  return inlines.map((i) => String(i.run?.text ?? '')).join('');
}

const BODY = { kind: 'story', storyType: 'body' };
const selectionOf = (blockId, start, end, story) => ({
  kind: 'selection',
  start: { kind: 'text', blockId, offset: start, story },
  end: { kind: 'text', blockId, offset: end, story },
  story,
});

/**
 * Change the case of the text in `segments` ([{ blockId, range }], the
 * engine's selection segments) to `mode`, using the painted page in `host`
 * for run boundaries. Resolves `{ changed, skipped }`: runs rewritten, and
 * paragraphs left alone because they were not painted or hold more than
 * plain text. Report successful replacements as they happen so partial
 * changes remain eligible for autosave if a later replacement fails.
 */
export async function applyCase(api, segments, mode, { host, story = BODY, onChange = () => {}, beforeWrite = () => {} } = {}) {
  let changed = 0;
  let skipped = 0;
  for (const seg of segments || []) {
    const range = seg?.range;
    if (!seg?.blockId || !range || !(range.end > range.start)) continue;
    let node = null;
    try {
      node = await (story.storyType === 'body'
        ? api.getNodeById({ nodeId: seg.blockId })
        : api.getNode({ kind: 'block', nodeType: 'paragraph', nodeId: seg.blockId, story }));
    } catch { /* leave text alone when its source cannot be read */ }
    const text = paragraphText(node);
    const pieces = text == null ? [] : runPieces(host, seg.blockId, range, text);
    if (!pieces.length) { skipped += 1; continue; }
    // Part of the paragraph sits on a page that is not painted: say so, and change what is.
    if (!paintedAcross(host, seg.blockId, range, text)) skipped += 1;
    // Unpainted or stale runs still contribute word and sentence boundaries,
    // even though only verified painted runs may be replaced.
    const whole = changeCase(text.slice(range.start, range.end), mode);
    const replacements = pieces.map((p) => ({ ...p, next: whole.slice(p.start - range.start, p.end - range.start) }));
    // Later pieces first, so earlier offsets stay valid even if a length shifts.
    for (const p of replacements.reverse()) {
      if (p.next === p.text) continue;
      // Editing can become unavailable between two runs (the mode switched to
      // viewing); the caller decides by throwing here.
      beforeWrite();
      const r = await api.replace({ target: selectionOf(seg.blockId, p.start, p.end, story), text: p.next });
      if (r == null || r.success === false) throw new Error(r?.failure?.message || 'Could not replace text');
      changed += 1;
      onChange();
    }
  }
  return { changed, skipped };
}
