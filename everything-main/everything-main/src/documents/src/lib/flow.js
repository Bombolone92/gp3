/**
 * Line and page breaks for a paragraph: whether it stays on the same page as
 * the next one, keeps all its lines together, avoids leaving a single line at
 * the top or bottom of a page (widow and orphan control), and whether a page
 * break comes before it (the one the Insert menu adds). DOCX stores all four.
 */

import { paragraphTarget } from './paragraphs.js';
import { readParagraphProperties } from './tabstops.js';

export const FLOW_OPTIONS = [
  { id: 'keepNext', label: 'Keep with next paragraph', hint: 'Headings stay on the same page as the text that follows.' },
  { id: 'keepLines', label: 'Keep lines together', hint: 'The paragraph never splits across pages.' },
  { id: 'widowControl', label: 'Widow and orphan control', hint: 'No single line is left alone at the top or bottom of a page.' },
  { id: 'pageBreakBefore', label: 'Page break before', hint: 'The paragraph starts a new page.' },
];

/** The defaults: nothing kept together, widow control on, no page break. */
export const FLOW_DEFAULTS = { keepNext: false, keepLines: false, widowControl: true, pageBreakBefore: false };

/**
 * The four options a paragraph's own properties set, from its `w:pPr` XML: an
 * element present means on unless its value says off. Options the XML does not
 * mention are left out. The engine reports none of these in a paragraph's
 * props, even right after writing them, so the document's XML is the source.
 */
export function parseFlowFlags(pPrXml) {
  if (typeof pPrXml !== 'string' || !pPrXml) return {};
  const flags = {};
  for (const id of Object.keys(FLOW_DEFAULTS)) {
    const element = new RegExp(`<w:${id}\\b([^>]*?)/?>`, 'i').exec(pPrXml);
    if (!element) continue;
    const value = /\bw:val="([^"]*)"/i.exec(element[1])?.[1];
    flags[id] = value == null || !/^(?:0|false|off)$/i.test(value.trim());
  }
  return flags;
}

/** The paragraph's own flow options read from the document's bytes ({} when they cannot be read). */
export async function readFlowFlags(blob, paraId, { story } = {}) {
  try { return parseFlowFlags(await readParagraphProperties(blob, paraId, { story })); } catch { return {}; }
}

/** Which of the four options the paragraph sets itself; the rest come from its style. */
export function flowKnown(props) {
  const p = props || {};
  return {
    keepNext: typeof (p.keepWithNext ?? p.keepNext) === 'boolean',
    keepLines: typeof p.keepLines === 'boolean',
    widowControl: typeof p.widowControl === 'boolean',
    pageBreakBefore: typeof p.pageBreakBefore === 'boolean',
  };
}

/**
 * The dialog's checkboxes for a paragraph's props. The engine reports these
 * only when the paragraph sets them, so missing values fall back to the
 * defaults; `flowKnown` tells which ones the paragraph actually sets.
 */
export function flowFromProps(props) {
  const p = props || {};
  const pick = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  return {
    keepNext: pick(p.keepWithNext ?? p.keepNext, FLOW_DEFAULTS.keepNext),
    keepLines: pick(p.keepLines, FLOW_DEFAULTS.keepLines),
    widowControl: pick(p.widowControl, FLOW_DEFAULTS.widowControl),
    pageBreakBefore: pick(p.pageBreakBefore, FLOW_DEFAULTS.pageBreakBefore),
  };
}

const ok = (r, what, onChange) => {
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || `${what} failed`);
  if (r.success !== false) onChange();
  return r;
};

/**
 * Apply the options named in `choice` to every paragraph in `ids`; an option
 * left out is not written, so a paragraph keeps what its style says for it.
 * Resolves how many paragraphs were written.
 */
export async function applyFlow(api, ids, choice, { story, beforeWrite = () => {}, onChange = () => {} } = {}) {
  const keep = Object.fromEntries(['keepNext', 'keepLines', 'widowControl'].filter((id) => typeof choice?.[id] === 'boolean').map((id) => [id, choice[id]]));
  const flow = typeof choice?.pageBreakBefore === 'boolean' ? { pageBreakBefore: choice.pageBreakBefore } : null;
  if (!Object.keys(keep).length && !flow) return 0;
  let n = 0;
  for (const nodeId of ids) {
    const target = paragraphTarget(nodeId, story);
    if (Object.keys(keep).length) { beforeWrite(); ok(await api.format.paragraph.setKeepOptions({ target, ...keep }), 'Keep options', onChange); }
    if (flow) { beforeWrite(); ok(await api.format.paragraph.setFlowOptions({ target, ...flow }), 'Page break', onChange); }
    n += 1;
  }
  return n;
}
