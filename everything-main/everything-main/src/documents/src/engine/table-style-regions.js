import { rowGrid } from './tables.js';

// The first row is always styled as firstRow when enabled, then includes
// consecutive following header-marked rows even if row zero is not repeated.
// Actual page repetition still requires a contiguous run starting at row zero.
export function tableStyleHeaderCount(table) {
  let count = Math.min(1, table.rows.length);
  while (count < table.rows.length && table.rows[count].header) count++;
  return count;
}

const LOOK_BITS = { firstRow: 0x20, lastRow: 0x40, firstColumn: 0x80, lastColumn: 0x100, noHBand: 0x200, noVBand: 0x400 };

// MS-OI29500 §17.4.55: omitted tblLook is 04A0. Explicit
// attributes supersede the legacy bit mask. Inputs are XML attribute values;
// this resolver owns no XML and does not modify retained declarations.
export function tableStyleLook(attributes = null) {
  const raw = attributes?.val;
  if (raw != null && !/^[0-9a-fA-F]{1,4}$/.test(raw)) throw new Error('Invalid table style look mask.');
  const bits = attributes === null ? 0x4A0 : raw == null ? 0 : parseInt(raw, 16);
  return Object.fromEntries(Object.entries(LOOK_BITS).map(([name, mask]) => {
    const value = attributes?.[name];
    if (value == null) return [name, !!(bits & mask)];
    if (!['1', '0', 'true', 'false', 'on', 'off'].includes(value)) throw new Error('Invalid table style look flag.');
    return [name, ['1', 'true', 'on'].includes(value)];
  }));
}

// Region order follows the documented §17.7.6.6 variation. Recompute from current
// grid/rows after structural edits; cnfStyle is a cached result, not a rule
// that moves a first-row format along with a copied row or cell.
export function tableStyleRegions(table, { look: defaultLook = tableStyleLook(), rowBandSize = 0, columnBandSize = 0, definedRegions = [] } = {}) {
  for (const size of [rowBandSize, columnBandSize]) if (!Number.isInteger(size) || size < 0 || size > 3) throw new Error('Unsupported table style band size.');
  const result = new Map(), rows = table.rows.length, columns = table.grid.length;
  const headerCount = tableStyleHeaderCount(table);
  const defined = new Set(definedRegions), has = name => defined.has(name);
  // Enabling a region with no declaration does not remove that row/column
  // from banding (the independent "bands-only" native reference).
  for (let r = 0; r < rows; r++) {
   const look = table.rows[r].styleLook || defaultLook;
   const firstRows = look.firstRow ? headerCount : 0;
   const rowStart = has('firstRow') ? firstRows : 0, rowEnd = rows - (look.lastRow && has('lastRow') ? 1 : 0);
   const columnStart = look.firstColumn && has('firstCol') ? 1 : 0, columnEnd = columns - (look.lastColumn && has('lastCol') ? 1 : 0);
   for (const { cell, column, end } of rowGrid(table.rows[r])) {
    const regions = [];
    const firstRow = r < firstRows, lastRow = look.lastRow && r === rows - 1;
    const firstColumn = look.firstColumn && column === 0, lastColumn = look.lastColumn && end === columns;
    if (!look.noHBand && rowBandSize && r >= rowStart && r < rowEnd) regions.push(Math.floor((r - rowStart) / rowBandSize) % 2 ? 'band2Horz' : 'band1Horz');
    if (!look.noVBand && columnBandSize && column >= columnStart && column < columnEnd) regions.push(Math.floor((column - columnStart) / columnBandSize) % 2 ? 'band2Vert' : 'band1Vert');
    if (firstColumn) regions.push('firstCol');
    if (lastColumn) regions.push('lastCol');
    if (firstRow) regions.push('firstRow');
    // The last-row region is omitted on a row already treated as firstRow,
    // rather than merging both property sets. Crossed border/run/shading
    // controls distinguish this from merely reversing their application order.
    if (lastRow && !firstRow) regions.push('lastRow');
    if (firstRow && firstColumn) regions.push('nwCell');
    if (firstRow && lastColumn) regions.push('neCell');
    if (lastRow && firstColumn) regions.push('swCell');
    if (lastRow && lastColumn) regions.push('seCell');
    result.set(cell.id, regions);
   }
  }
  return result;
}

// Within a named region, absent property groups are inherited but replaces a
// present group as a whole. In particular, a child's rPr containing only bold
// does not inherit the parent's regional color. Separate tcPr still inherits.
// wholeTable is intentionally excluded (MS-OI29500 §17.18.89).
export function conditionalStyleGroups(chain, regions) {
  return regions.filter(name => name !== 'wholeTable').map(name => Object.assign({}, ...chain.map(style => style.conditionals?.[name])));
}
