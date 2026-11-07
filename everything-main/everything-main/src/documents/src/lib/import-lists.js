/**
 * List items the converter cannot write. A Markdown or HTML list item may
 * hold a table or a heading; the engine refuses to materialize either inside
 * an item ("List item block kind \"table\" is not materializable"), and with
 * it the whole import. The item keeps its paragraphs, the table or heading
 * follows the list at that point, and the rest of the list continues after
 * it with its numbering carried on.
 */

const HOISTED = new Set(['table', 'heading']);

const emptyParagraph = () => ({ kind: 'paragraph', paragraph: { inlines: [] } });

/** `fragment` with every table and heading lifted out of the list items that hold one. */
export function hoistListBlocks(fragment) {
  if (!Array.isArray(fragment)) return fragment;
  const out = [];
  for (const block of fragment) {
    const items = block?.kind === 'list' ? block.list?.items : null;
    if (!Array.isArray(items) || !items.some((item) => (item.content || []).some((b) => HOISTED.has(b?.kind)))) { out.push(block); continue; }
    let levels = block.list.levels || [];
    let current = [];
    // Level-0 items already written: the next piece of the list starts its numbering after them.
    let written = 0;
    const flush = () => {
      if (!current.length) return;
      out.push({ ...block, list: { ...block.list, levels, items: current } });
      written += current.filter((item) => !item.level).length;
      levels = levels.map((level) => (level.level === 0 && level.kind === 'ordered' ? { ...level, start: (Number(level.start) || 1) + current.filter((item) => !item.level).length } : level));
      current = [];
    };
    for (const item of items) {
      const kept = (item.content || []).filter((b) => !HOISTED.has(b?.kind));
      const hoisted = (item.content || []).filter((b) => HOISTED.has(b?.kind));
      current.push(hoisted.length && !kept.length ? { ...item, content: [emptyParagraph()] } : { ...item, content: kept });
      if (hoisted.length) { flush(); out.push(...hoisted); }
    }
    flush();
  }
  return out;
}

/** Whether an insert receipt refused a list item's block, which hoisting can mend. */
export const refusedListBlock = (receipt) => receipt?.success === false && receipt.failure?.code === 'CAPABILITY_UNSUPPORTED' && /List item block kind/i.test(receipt.failure?.message || '');
