import { paragraphBorderInsets } from './paragraph-borders.js';

export function rowMinimumHeight(row) {
  const natural = Math.max(0, ...row.cells.map(cell => blockMinimumHeight(cell.blocks[0]) + (cell.margins.top + cell.margins.bottom) / 15));
  return row.fixedHeight == null ? natural : Math.min(row.fixedHeight, natural);
}

// The first printable content may be a table at any nesting level.
export function blockMinimumHeight(block) {
  if (block.lines) return block.lines[0].height + paragraphBorderInsets(block);
  if (block.tableHeader) return block.tableHeader.height + block.tableHeader.minimum;
  return rowMinimumHeight(block.tableRow || block.tableGroup.rows[0]);
}

export function* paragraphLayoutBlocks(blocks) {
  for (const block of blocks) {
    if (block.lines) yield block;
    else {
      const rows = block.tableRow ? [block.tableRow] : block.tableGroup?.rows || [...(block.tableHeader.headerRows || []), ...block.tableHeader.rows];
      for (const row of rows) for (const cell of row.cells) yield* paragraphLayoutBlocks(cell.blocks);
    }
  }
}
