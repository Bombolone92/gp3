import { borderOutset } from './paragraph-borders.js';
import { paragraphLayoutBlocks } from './block-layout.js';
import { shiftCellClip } from './cell-clipping.js';
import { isCellRelativePosition, isPageBasedCellPosition, positionedImageFrame } from './positioned-images.js';
import { EMU_PER_PX } from './images.js';
import { pageBounds } from './page-bounds.js';

/** Align the content already assigned to each physical cell fragment. Row
 * allocation and text pagination stay independent of its vertical placement. */
export function alignCellContent(cell, result, startPage, boxes) {
  const shifts = new Map();
  const formats = cell.vertical && cell.vertical !== 'top' ? new Map([...paragraphLayoutBlocks(cell.blocks)].map(block => [block.lines[0].paragraphId, block.format])) : null;
  if (formats) for (const box of boxes) {
    const last = result.lines.findLast(line => line.page + startPage === box.page && !line.virtual);
    if (!last) continue;
    const after = last.paragraphEnd ? (formats.get(last.paragraphId)?.spaceAfter || 0) * 4 / 3 : 0;
    const nestedEnd = Math.max(0, ...(result.cells || []).filter(c => c.page + startPage === box.page).map(c => c.y + c.height));
    let drawingEnd = 0;
    const firstLines = new Map();
    for (const line of result.lines) if (line.page + startPage === box.page) {
      if (!firstLines.has(line.paragraphId)) firstLines.set(line.paragraphId, line);
      for (const fragment of line.fragments || []) if (fragment.image?.anchor?.wrap === 'none' && (isCellRelativePosition(fragment.image)
        || line.cellId === cell.id && isPageBasedCellPosition(fragment.image) && (fragment.image.anchor.layoutInCell !== false || (cell.page.compatibilityMode ?? 12) >= 15))) {
        const frame = positionedImageFrame(fragment, firstLines.get(line.paragraphId), cell.page, box);
        drawingEnd = Math.max(drawingEnd, frame.y + frame.height + (fragment.image.effectExtent?.bottom || 0) / EMU_PER_PX);
      }
    }
    const end = Math.min(pageBounds(cell.page, box.page).bottom, Math.max(nestedEnd, drawingEnd, last.y + last.height + after + borderOutset(last.paragraphFrame?.borders.bottom)));
    const free = Math.max(0, box.y + box.height - cell.margins.bottom / 15 - end);
    shifts.set(box.page, free * (cell.vertical === 'center' ? .5 : 1));
  }
  const alignLine = line => {
    const page = startPage + line.page, shift = shifts.get(page) || 0;
    return { ...line, page, y: line.y + shift, baseline: line.baseline + shift,
      // Nested cells retain their own alignment shift; their physical boxes
      // already receive the outer cell's translation.
      ...(line.cellId === cell.id ? { cellAlignmentShift: shift } : {}),
      ...(line.cellClip ? { cellClip: shiftCellClip(line.cellClip, shift) } : {}) };
  };
  return { lines: result.lines.map(alignLine), repeatedLines: (result.repeatedLines || []).map(alignLine), cells: (result.cells || []).map(box => {
    const page = startPage + box.page, shift = shifts.get(page) || 0;
    return { ...box, page, y: box.y + shift, ...(box.cellClip ? { cellClip: shiftCellClip(box.cellClip, shift) } : {}) };
  }) };
}

export const alignCellLines = (cell, result, startPage, boxes) => alignCellContent(cell, result, startPage, boxes).lines;
