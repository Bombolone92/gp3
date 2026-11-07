import { floatingTableX } from './floating-tables.js';
import { pageBounds } from './page-bounds.js';
import { shiftTableItem } from './table-overlap.js';
import { tableBorderWidth } from './table-border-layout.js';

// Floats within the same cell are separated even when tblOverlap permits
// overlap. Their frame reserves fifteen twips at the right and a minimum ten
// twips of clearance at the next table's left; explicit text distances add.
function avoidNestedOverlap(frame, previous, right) {
  const leftGap = f => (f.leftInk || 0) + Math.max(10, f.position.leftFromText) / 15;
  const rightGap = f => Math.max(1, f.rightInk || 0) + f.position.rightFromText / 15;
  const width = frame.right - frame.left, height = frame.bottom - frame.top;
  let placed = frame;
  for (let attempt = 0; attempt < (previous.length + 1) ** 2; attempt++) {
    const hit = previous.find(f => placed.left < f.right + rightGap(f) + leftGap(placed)
      && placed.right + rightGap(placed) + leftGap(f) > f.left
      && placed.top < f.bottom + (f.position.bottomFromText + placed.position.topFromText) / 15
      && placed.bottom > f.top - (f.position.topFromText + placed.position.bottomFromText) / 15);
    if (!hit) return placed;
    let left = hit.right + rightGap(hit) + leftGap(placed), top = placed.top;
    if (left + width + rightGap(placed) > right) {
      left = frame.left;
      top = hit.bottom + (hit.position.bottomFromText + placed.position.topFromText) / 15;
    }
    placed = { ...placed, left, right: left + width, top, bottom: top + height };
  }
  throw new Error('Nested floating-table collision placement did not converge.');
}

// A nested table's containing cell serves as the page positioning box.
// Margin/text anchors use its writing edges. Keep the declared OOXML intact.
export function nestedFloatingTableX(position, page, width, cell, pageIndex = 0, ink = {}) {
  const left = position.horzAnchor === 'page' ? cell.left : page.left;
  const right = position.horzAnchor === 'page' ? cell.right : page.width - page.right;
  // Native controls distinguish the first row's left overhang from the widest
  // right border in any row. The right frame already reserves fifteen twips;
  // only ink beyond that clearance adds to the alignment width.
  const leftInk = ink.left || 0, extraRight = Math.max(0, (ink.right || 0) - 15 / 15);
  const alignmentWidth = width + leftInk + extraRight;
  const frameWidth = alignmentWidth + 12 / 15;
  const x = floatingTableX({ ...position, horzAnchor: 'margin' },
    { ...page, left, right: page.width - right, compatibilityMode: 15 }, alignmentWidth, pageIndex);
  return Math.max(cell.left, Math.min(cell.right - frameWidth, x)) + leftInk;
}

// Called by the cell's paginator, so a floating table contributes to its owning
// row's extent without consuming a normal-flow block between the paragraphs.
export function placeNestedFloatingTables(floats, result, page, maxPages, startY, paginate) {
  if (result.pageCount !== 1) throw new Error('Floating tables in split parent cells are not supported yet.');
  const frames = [];
  for (const floating of floats) {
    const anchor = result.lines.find(line => line.paragraphId === floating.anchorId);
    if (!anchor) throw new Error('Missing nested floating-table anchor.');
    const position = floating.position;
    const top = anchor.page === 0 ? startY : page.cellFragments?.[anchor.page]?.top ?? pageBounds(page, anchor.page).top;
    const origin = position.vertAnchor === 'text' ? anchor.y - (anchor.anchorBefore || 0) : top;
    const y = Math.max(top, position.tblpYSpec ? top : origin + position.tblpY / 15);
    const placed = paginate(floating.blocks, { ...page, pageBounds: undefined, cellFragments: undefined,
      height: 1e9, top: 0, bottom: 0 }, maxPages, y);
    if (placed.pageCount !== 1) throw new Error('Multi-page nested floating tables are not supported yet.');
    const cells = placed.cells.filter(c => c.tableId === floating.tableId);
    const left = Math.min(...cells.map(c => c.x)), right = Math.max(...cells.map(c => c.x + c.width));
    const leftInk = tableBorderWidth(cells.find(c => c.x === left)?.borders.left) / 2;
    const rightInk = Math.max(0, ...cells.filter(c => Math.abs(c.x + c.width - right) < 1e-6).map(c => tableBorderWidth(c.borders.right) / 2));
    const frame = avoidNestedOverlap({ left, right, leftInk, rightInk, top: y, bottom: placed.endY, position }, frames, floating.cellRight);
    if (!page.clipOverflow && frame.bottom > pageBounds(page, anchor.page).bottom + 1e-6) {
      throw new Error('Nested floating tables crossing a page boundary are not supported yet.');
    }
    for (const key of ['lines', 'cells', 'repeatedLines']) {
      result[key].push(...placed[key].map(item => ({ ...shiftTableItem(item, frame.left - left, frame.top - y), page: item.page + anchor.page })));
    }
    frames.push(frame);
    if (anchor.page === result.pageCount - 1) result.endY = Math.max(result.endY, frame.bottom + position.bottomFromText / 15);
  }
  result.lines.sort((a, b) => a.start - b.start);
  return result;
}
