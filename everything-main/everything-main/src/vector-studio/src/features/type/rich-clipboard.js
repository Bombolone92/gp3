/**
 * Formatted copy and paste of characters between type objects.
 *
 * Copying characters while editing puts plain text on the system clipboard
 * and keeps the characters' full styles here. Pasting that same text back
 * (Edit > Paste) restores the styles; Paste Without Formatting, or text
 * that came from elsewhere, takes the style at the insertion point.
 */
import { styledRuns, replaceRange, applyRunStyle, RUN_KEYS } from '../../model/text-runs.js';

let rich = null; // { text, segs: [{ len, style }] }

/** Remember the styles of a session's selected characters. */
export function rememberRichCopy(session) {
  const n = session.node();
  const [a, b] = session.range();
  if (!n || b <= a) return;
  const segs = [];
  for (const r of styledRuns(n)) {
    const s = Math.max(a, r.start);
    const e = Math.min(b, r.end);
    if (e <= s) continue;
    const style = {};
    for (const k of RUN_KEYS) style[k] = r.style[k];
    segs.push({ len: e - s, style });
  }
  rich = { text: n.text.slice(a, b), segs };
}

/** The formatted copy for clipboard text, when the text is what was copied here. */
export function richFor(text) {
  if (!rich || !text) return null;
  const norm = (t) => String(t).replace(/\r\n?/g, '\n');
  return norm(text) === rich.text ? rich : null;
}

export function clearRichCopy() {
  rich = null;
}

/** Paste clipboard text into a session: formatted when it is our own copy (unless `plain`). */
export function pasteIntoSession(session, text, { plain = false } = {}) {
  const r = plain ? null : richFor(text);
  if (!r) {
    session.insert(text, 'paste');
    return;
  }
  const n = session.node();
  if (!n) return;
  const [a, b] = session.range();
  session.doc.transact('Paste', () => {
    let cur = { ...n, ...replaceRange(n, a, b, r.text, r.segs[0]?.style || null) };
    let pos = a;
    for (const seg of r.segs) {
      cur = { ...cur, runs: applyRunStyle(cur, pos, pos + seg.len, seg.style) };
      pos += seg.len;
    }
    session.doc.update(n.id, { text: cur.text, runs: cur.runs, paras: cur.paras, char: cur.char, fill: cur.fill, stroke: cur.stroke, strokeWidth: cur.strokeWidth });
  });
  session.burst++;
  session.lastKind = null;
  session.caret = session.anchor = a + r.text.length;
  session.goalU = null;
  session.sync();
}
