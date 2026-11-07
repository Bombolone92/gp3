import { anchorFromHref, decodeBookmarkName } from './bookmarks.js';

/**
 * A link's anchor offsets do not count the object characters (footnote and
 * endnote references) that the paragraph's text and every selection offset
 * count: this puts an anchor offset into the text's coordinates.
 */
export function anchorToText(text, offset) {
  if (typeof text !== 'string' || !text.includes('\uFFFC')) return offset;
  let seen = 0;
  for (let i = 0; i < text.length && i - seen < offset; i++) if (text[i] === '\uFFFC') seen += 1;
  return offset + seen;
}

/** A link's anchor in the paragraph text's coordinates. */
export function textAnchor(link, text) {
  const range = link?.address?.anchor;
  if (!range?.start || !range?.end || typeof text !== 'string') return range;
  return { ...range, start: { ...range.start, offset: anchorToText(text, range.start.offset) }, end: { ...range.end, offset: anchorToText(text, range.end.offset) } };
}

/** The paragraph's text as the engine reports it, or null when it cannot be read. */
async function paragraphTextOf(api, blockId) {
  try {
    const node = await api.getNodeById?.({ nodeId: blockId });
    const inlines = (node?.node?.paragraph || node?.node?.heading)?.inlines || [];
    return inlines.every((i) => i?.kind === 'run') ? inlines.map((i) => String(i.run?.text ?? '')).join('') : null;
  } catch { return null; }
}

/** Resolve the entire selection; an active destination disambiguates a shared caret boundary. */
export async function findSelectedHyperlink(api, selection, href = '') {
  const start = selection?.start, end = selection?.end || start;
  if (!start?.blockId || (end?.blockId && end.blockId !== start.blockId)) return null;
  const a = Number(start.offset ?? 0), b = Number(end?.offset ?? a);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  const from = Math.min(a, b), to = Math.max(a, b);
  const result = await api.hyperlinks.list();
  const links = result?.items || [];
  const text = await paragraphTextOf(api, start.blockId);
  let fields;
  const normalize = link => {
    const anchor = link.properties?.anchor;
    if (!anchor) return link;
    const decoded = decodeBookmarkName(anchor);
    if (decoded === anchor) return link;
    // Element anchors retain XML escapes; parsed field anchors do not. Only
    // the body inventory can identify the public body's field hyperlinks.
    fields ??= new Set((result.stories || []).filter(story => story.partUri === '/word/document.xml')
      .flatMap(story => (story.hyperlinks || []).filter(source => source.sourceKind === 'field').map(source => source.hyperlinkNodeId)));
    return fields.has(link.id) ? link : { ...link, properties: { ...link.properties, anchor: decoded } };
  };
  const matches = links.filter(link => {
    const range = textAnchor(link, text);
    return range?.start?.blockId === start.blockId && range?.end?.blockId === start.blockId
      && range.start.offset <= from && to <= range.end.offset;
  }).map(normalize);
  if (matches.length === 1) return matches[0];
  if (!href) return null;
  const anchor = anchorFromHref(href);
  const known = matches.filter(link => anchor ? link.properties?.anchor === anchor : link.properties?.href === href);
  return known.length === 1 ? known[0] : null;
}
