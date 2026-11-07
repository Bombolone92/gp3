import { tableStyleRegions, conditionalStyleGroups, tableStyleHeaderCount } from './table-style-regions.js';
import { rowGrid } from './tables.js';
import { resolveCellMargins } from './cell-margins.js';
import { resolveCellBorders, rowTableBorder } from './cell-borders.js';
import { cellShadingFill } from './backgrounds.js';

function bounds(table, settings, name, row, column) {
  const { look, rowBandSize, columnBandSize, definedRegions } = settings;
  const defined = new Set(definedRegions), rows = table.rows.length, columns = table.grid.length;
  let top = 0, bottom = rows, left = 0, right = columns;
  if (['firstRow', 'lastRow', 'nwCell', 'neCell', 'swCell', 'seCell'].includes(name)) { top = row; bottom = row + 1; }
  if (['firstCol', 'nwCell', 'swCell'].includes(name)) right = 1;
  if (['lastCol', 'neCell', 'seCell'].includes(name)) left = columns - 1;
  if (name.endsWith('Horz')) {
    const start = look.firstRow && defined.has('firstRow') ? tableStyleHeaderCount(table) : 0;
    top = start + Math.floor((row - start) / rowBandSize) * rowBandSize;
    bottom = Math.min(top + rowBandSize, rows - (look.lastRow && defined.has('lastRow') ? 1 : 0));
  }
  if (name.endsWith('Vert')) {
    const start = look.firstColumn && defined.has('firstCol') ? 1 : 0;
    left = start + Math.floor((column - start) / columnBandSize) * columnBandSize;
    right = Math.min(left + columnBandSize, columns - (look.lastColumn && defined.has('lastCol') ? 1 : 0));
  }
  return { top, bottom, left, right };
}

// Called on import and on topology/header edits, never on each keystroke.
// Effective inherited values are recomputed separately from direct edits and
// retained source XML. No style declarations are materialized into tcPr.
export function refreshConditionalTable(table) {
  const source = table.conditionalStyle;
  if (!source) return null;
  if (source.chain.some(s => Object.values(s.conditionals).some(g => g.row && 'header' in g.row))) {
    // Resolve row flags from base/direct rows first. Re-running the row rules
    // against their own result would make header-dependent banding oscillate.
    for (const row of table.rows) if (!row.headerExplicit && !row.headerChanged) row.header = !!source.row?.header;
    const initial = tableStyleRegions(table, source.settings);
    const order = ['band1Horz', 'band2Horz', 'band1Vert', 'band2Vert', 'firstCol', 'lastCol', 'firstRow', 'lastRow', 'nwCell', 'neCell', 'swCell', 'seCell'];
    for (const row of table.rows) {
      if (row.headerExplicit || row.headerChanged) continue;
      const selected = new Set(row.cells.flatMap(cell => initial.get(cell.id)));
      for (const group of conditionalStyleGroups(source.chain, order.filter(name => selected.has(name)))) {
        if (group.row?.header !== undefined) row.header = group.row.header;
      }
    }
  }
  const regions = tableStyleRegions(table, source.settings), cells = new Map();
  for (const [r, row] of table.rows.entries()) for (const { cell, column, end } of rowGrid(row)) {
    const base = source.cell;
    let defaults = { ...table.margins }, exceptions = { ...base.margins }, borders = { ...base.borders };
    let shading = base.shading ?? 'auto', vertical = base.vertical || 'top', noWrap = base.noWrap || false;
    let writingTop = base.borders?.top ?? rowTableBorder(table, r, r === 0 ? 'top' : 'insideH') ?? null;
    const names = regions.get(cell.id), groups = conditionalStyleGroups(source.chain, names);
    for (let i = 0; i < names.length; i++) {
      const edge = bounds(table, row.styleLook ? {...source.settings,look:row.styleLook} : source.settings, names[i], r, column);
      for (const group of [groups[i].table, groups[i].cell]) if (group) {
        if (group === groups[i].table) defaults = resolveCellMargins(defaults, group.margins);
        else exceptions = { ...exceptions, ...group.margins };
        if (group === groups[i].cell) shading = group.shading ?? shading;
        vertical = group.vertical ?? vertical;
        noWrap = group.noWrap ?? noWrap;
        const declarations = group.borders || {}, selected = {};
        for (const [side, key] of Object.entries({ top: r === edge.top ? 'top' : 'insideH', bottom: r + 1 >= edge.bottom ? 'bottom' : 'insideH', left: column === edge.left ? 'left' : 'insideV', right: end >= edge.right ? 'right' : 'insideV' })) {
          if (declarations[key]) {
            selected[side] = declarations[key];
            if (side === 'top') {
              // A column region's insideH paints without being reserved as
              // the next row's own top border. Row-region rules do reserve it.
              const columnRegion = ['firstCol', 'lastCol', 'band1Vert', 'band2Vert'].includes(names[i]);
              writingTop = columnRegion && key === 'insideH' ? null : resolveCellBorders({}, {top:declarations[key]}).top ?? rowTableBorder(table, r, r === 0 ? 'top' : 'insideH');
            }
          }
        }
        borders = resolveCellBorders(borders, selected);
      }
    }
    cell.marginDefaults = resolveCellMargins(defaults, row.styleMargins);
    cell.inheritedMargins = resolveCellMargins(cell.marginDefaults, exceptions);
    cell.margins = resolveCellMargins(cell.inheritedMargins, cell.directMargins, cell.marginDefaults);
    cell.inheritedBorders = borders; cell.borders = resolveCellBorders(borders, cell.directBorders);
    cell.styleWritingTopBorder = writingTop;
    cell.inheritedShading = shading;
    if (!cell.shadingExplicit || cell.shadingNil) cell.shading = shading;
    cell.fill = cellShadingFill(cell.shading);
    // In compatibility mode 15, a non-top unconditional cell alignment takes precedence over
    // conditional table-style alignment. Direct cell formatting still wins.
    if ((source.settings.compatibilityMode ?? 12) >= 15 && base.vertical && base.vertical !== 'top') vertical = base.vertical;
    cell.inheritedVertical = vertical;
    if (!cell.verticalExplicit) cell.vertical = vertical;
    if (!cell.noWrapExplicit) cell.noWrap = noWrap;
    cell.styleRegions = names; cells.set(cell.id, cell);
  }
  return cells;
}
