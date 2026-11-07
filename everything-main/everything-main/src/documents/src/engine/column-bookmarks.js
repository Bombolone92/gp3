import { rowGrid, verticalMerges } from './tables.js';

const size = p => p.runs.reduce((n, r) => n + r.text.length, 0);

export class ColumnBookmarkRangeError extends Error {}

// Column attributes index physical cells in the first bookmarked row. Its cell
// spans define the region intersected by the following rows (native controls).
// Keep these cells separate from the enclosing source-marker text interval.
export function columnBookmarkResolver(paragraphs, tables) {
  const cells = new Map(), byTable = new Map(tables.map(t => [t.id, t]));
  const byParagraph = new Map(), offsets = new Map(); let offset = 0;
  for (const table of tables) for (const [rowIndex, row] of table.rows.entries())
    for (const cell of row.cells) cells.set(cell.id, { table, row, rowIndex, cell });
  for (const p of paragraphs) { byParagraph.set(p.id, p); offsets.set(p.id, offset); offset += size(p) + 1; }
  const inTable = (cellId, tableId) => {
    let context = cells.get(cellId), depth = 0;
    while (context && context.table.id !== tableId) {
      if (depth++ > tables.length) throw new Error('Cyclic table bookmark ownership.');
      context = cells.get(context.table.parentCellId);
    }
    return context;
  };
  return entry => {
    const columns = entry.startMarker.tableColumns;
    if (!columns || entry.start === entry.end && entry.startParagraph === entry.endParagraph) return null;
    const start = entry.startMarker, end = entry.endMarker;
    const startParagraph = byParagraph.get(entry.startParagraph), endParagraph = byParagraph.get(entry.endParagraph);
    const table = byTable.get(start.tableBoundary?.tableId) || cells.get(start.blockScope)?.table || byTable.get(start.blockTableId) || cells.get(startParagraph?.cellId)?.table;
    if (!table) return null;
    const endpoint = (marker, p, edge) => {
      const boundary = marker.tableBoundary;
      if (boundary?.tableId === table.id) {
        let index = table.rows.findIndex(row => row.id === boundary.rowId);
        if (index < 0) return null;
        if (!boundary.cellId && (edge === 'start' && boundary.side === 'after' || edge === 'end' && boundary.side === 'before')) index += edge === 'start' ? 1 : -1;
        return index;
      }
      const scope = inTable(marker.blockScope, table.id);
      if (scope) return scope.rowIndex;
      if (marker.blockTableId === table.id) return marker.blockBoundary === 'before' ? 0 : table.rows.length - 1;
      return inTable(p?.cellId, table.id)?.rowIndex ?? null;
    };
    const firstRow = endpoint(start, startParagraph, 'start'), lastRow = endpoint(end, endParagraph, 'end');
    // Attributes on a range extending outside its table have no column scope.
    if (firstRow === null || lastRow === null) return null;
    if (firstRow < 0 || lastRow >= table.rows.length || firstRow > lastRow) throw new ColumnBookmarkRangeError('Invalid column bookmark row range.');
    const grid = rowGrid(table.rows[firstRow]);
    let first = BigInt(columns.first); const last = BigInt(columns.last);
    // Negative hints are ignored, the last physical column is clipped, and
    // a reversed first index is lowered to the last. Overlarge first indices yield
    // an empty column selection rather than becoming an ordinary text range.
    if (first < 0n || last < 0n) return null;
    if (first > last) first = last;
    const empty = first >= BigInt(grid.length);
    const left = empty ? grid.at(-1).end : grid[Number(first)].column;
    const right = empty ? left : grid[Number(last < BigInt(grid.length) ? last : BigInt(grid.length - 1))].end;
    const owners = verticalMerges(table), selected = new Set(), physical = [];
    for (const row of table.rows.slice(firstRow, lastRow + 1)) for (const item of rowGrid(row)) {
      if (item.column >= right || item.end <= left) continue;
      const owner = owners.get(item.cell.id);
      if (owner.rowIndex < firstRow || selected.has(owner.cell.id)) continue;
      physical.push(owner.cell.id); selected.add(owner.cell.id);
    }
    const ranges = [];
    for (const p of paragraphs) {
      const context = inTable(p.cellId, table.id);
      if (context && selected.has(context.cell.id)) ranges.push({ paragraphId: p.id, start: offsets.get(p.id), end: offsets.get(p.id) + size(p) });
    }
    const firstRowLast = paragraphs.findLast(p => inTable(p.cellId, table.id)?.rowIndex === firstRow);
    const target = ranges[0]?.start ?? (firstRowLast ? offsets.get(firstRowLast.id) + size(firstRowLast) : entry.start);
    return { tableId: table.id, rowIds: table.rows.slice(firstRow, lastRow + 1).map(row => row.id),
      first: left, end: right, empty, cellIds: physical, ranges, target };
  };
}
