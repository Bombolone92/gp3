/**
 * Paragraph borders and shading, and the horizontal rule built from them.
 * A "horizontal line" is an empty paragraph with a bottom border,
 * which is also how it round-trips through .docx, so that is what Insert >
 * Horizontal line creates. Border widths are in points; the Document API
 * takes eighths of a point.
 */

import { paragraphTarget, readParagraph, selectionStory } from './paragraphs.js';

/** Which edges get a line. */
export const BORDER_SIDE_PRESETS = [
  { id: 'none', label: 'None', sides: [] },
  { id: 'all', label: 'All', sides: ['top', 'bottom', 'left', 'right'] },
  { id: 'topBottom', label: 'Top and bottom', sides: ['top', 'bottom'] },
  { id: 'bottom', label: 'Bottom', sides: ['bottom'] },
  { id: 'top', label: 'Top', sides: ['top'] },
  { id: 'left', label: 'Left', sides: ['left'] },
];

export const BORDER_STYLES = [
  { id: 'single', label: 'Solid' },
  { id: 'double', label: 'Double' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];

/** Line widths offered, in points. */
export const BORDER_WIDTHS = [0.5, 0.75, 1, 1.5, 2.25, 3];

/** The rule Insert > Horizontal line draws. */
export const RULE_BORDER = { style: 'single', widthPt: 0.75, color: null, spacePt: 1 };

const paragraph = paragraphTarget;

const ok = (r, what, onChange = () => {}) => {
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || `${what} failed`);
  if (r.success !== false) onChange();
  return r;
};

/** The Document API's border input for one side: points to eighths, a null color to 'auto'. */
export function borderPayload({ style = 'single', widthPt = 0.75, color = null, spacePt = 1 } = {}) {
  const w = Number.isFinite(widthPt) && widthPt > 0 ? widthPt : 0.75;
  return { style: style || 'single', size: Math.max(2, Math.round(w * 8)), space: Math.max(0, Math.round(spacePt || 0)), color: color ? color.replace(/^#/, '') : 'auto' };
}

/**
 * Give each paragraph the borders of a side preset (replacing whatever lines
 * it had), drawn in `style`, `widthPt`, and `color` (null for automatic).
 */
export async function applyParagraphBorders(api, ids, { preset = 'none', style, widthPt, color } = {}, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  const sides = BORDER_SIDE_PRESETS.find((p) => p.id === preset)?.sides || [];
  const payload = borderPayload({ style, widthPt, color });
  for (const nodeId of ids) {
    const target = paragraph(nodeId, story);
    beforeWrite();
    ok(await api.format.paragraph.clearBorder({ target, side: 'all' }), 'Borders', onChange);
    for (const side of sides) {
      beforeWrite();
      ok(await api.format.paragraph.setBorder({ target, side, ...payload }), 'Borders', onChange);
    }
  }
}

/** Fill the paragraphs' background with a color ('#rrggbb'), or clear it with null. */
export async function shadeParagraphs(api, ids, fill, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  for (const nodeId of ids) {
    const target = paragraph(nodeId, story);
    beforeWrite();
    if (fill) ok(await api.format.paragraph.setShading({ target, fill: fill.replace(/^#/, ''), pattern: 'clear' }), 'Shading', onChange);
    else ok(await api.format.paragraph.clearShading({ target }), 'Shading', onChange);
  }
}

/** Whether a paragraph or heading (from getNodeById) holds no content. */
export function isEmptyParagraph(node) {
  const content = node?.node?.paragraph || node?.node?.heading;
  const inlines = content?.inlines;
  if (!Array.isArray(inlines)) return false;
  return !inlines.some((i) => (i?.run?.text || '').length > 0 || (i && i.kind && i.kind !== 'run'));
}

const committed = (r) => r != null && r !== false && r.success !== false && (!r.status || r.status === 'committed');

/**
 * Insert a horizontal rule at the caret: an empty paragraph whose bottom
 * border draws the line, with the caret left on the paragraph below it. In
 * the middle of a paragraph the text splits around a new blank line that
 * takes the border; at the end of one, or on a blank line, the rule goes
 * there and typing continues on a fresh paragraph under it.
 * `ed` is the engine's active editor (its `doc` and `editCommands`).
 * Resolves true when the rule is in place.
 */
export async function insertHorizontalRule(ed, { beforeWrite = () => {}, onChange = () => {} } = {}) {
  const api = ed?.doc;
  if (!api?.format?.paragraph || !ed.editCommands?.text) return false;
  const selection = await api.selection.current();
  const story = selectionStory(selection);
  const caretParagraph = async () => (await api.selection.current())?.selectionTarget?.start?.blockId || null;
  const isBlank = async (nodeId) => {
    const node = await readParagraph(api, nodeId, story);
    const content = node?.node?.paragraph || node?.node?.heading;
    if (!Array.isArray(content?.inlines)) throw new Error('Could not read the paragraph to insert a horizontal line');
    return isEmptyParagraph(node);
  };
  const enter = async () => {
    beforeWrite();
    const changed = committed(await ed.editCommands.text.enter());
    if (changed) onChange();
    return changed;
  };
  const rule = async (nodeId) => {
    beforeWrite();
    return ok(await api.format.paragraph.setBorder({ target: paragraph(nodeId, story), side: 'bottom', ...borderPayload(RULE_BORDER) }), 'Horizontal line', onChange);
  };

  let nodeId = selection?.selectionTarget?.start?.blockId;
  if (!nodeId) return false;
  if (!(await isBlank(nodeId))) {
    if (!(await enter())) return false;
    const tail = await caretParagraph();
    if (!tail) return false;
    if (!(await isBlank(tail))) {
      // The caret was mid-paragraph: the text after it now starts a paragraph
      // of its own. Open a blank line above it for the rule; the caret stays
      // with the text. The blank line is created in place rather than with a
      // second Enter and a search of the block list, which lists top-level
      // blocks only and so never found a paragraph inside a table cell.
      let blank = null;
      if (api.create?.paragraph) {
        beforeWrite();
        const created = await api.create.paragraph({ at: { kind: 'before', target: paragraph(tail, story) }, text: '', ...(story ? { in: story } : {}) });
        blank = created?.success !== false ? created?.paragraph?.nodeId || null : null;
        if (blank) onChange();
      } else {
        if (!(await enter())) return false;
        const below = await caretParagraph();
        const blocks = (await api.blocks.list(story ? { in: story } : {}))?.blocks || [];
        const at = blocks.findIndex((b) => b.nodeId === below);
        blank = at > 0 ? blocks[at - 1].nodeId : null;
      }
      if (!blank) return false;
      await rule(blank);
      return true;
    }
    nodeId = tail;
  }
  await rule(nodeId);
  // Typing continues under the line. The new paragraph does not inherit the
  // border, but clear it anyway in case the engine ever copies it.
  if (await enter()) {
    const next = await caretParagraph();
    if (next && next !== nodeId) {
      beforeWrite();
      try { ok(await api.format.paragraph.clearBorder({ target: paragraph(next, story), side: 'all' }), 'Horizontal line', onChange); } catch { /* defensive cleanup */ }
    }
  }
  return true;
}
