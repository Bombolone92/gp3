import { tableBorderWidth } from './table-border-layout.js';
import { intersectCellClip } from './cell-clipping.js';
import { imageExtents, EMU_PER_PX, isPositionedImage } from './images.js';

export class UnsupportedRotatedCellError extends Error {
  constructor(message, cellId) { super(message); this.cellId = cellId; }
}

export function rotatedCellTextMetrics(metrics, style) {
  const halfLeading = style.fontSize * 4 / 3 / 64;
  return { ...metrics, ascent: metrics.ascent + halfLeading, descent: metrics.descent + halfLeading,
    ...(metrics.lineAscent === undefined ? {} : { lineAscent: metrics.lineAscent + halfLeading }),
    ...(metrics.lineDescent === undefined ? {} : { lineDescent: metrics.lineDescent + halfLeading }),
  };
}

// A rotated cell's automatic physical height is driven by its terminal mark,
// not the number or widths of its rotated lines. The caller supplies resolved
// paragraph formatting and measured mark metrics; it adds physical cell insets.
// Native paired controls isolate 1/32 em of extra mark leading in btLr/tbRl,
// including fonts with different external leading and sizes from 6 to 200pt.
export function rotatedCellMinimumHeight(format, markStyle, metrics) {
  const natural = (metrics.lineAscent ?? metrics.ascent) + (metrics.lineDescent ?? metrics.descent)
    + markStyle.fontSize * 4 / 3 / 32;
  const line = format.lineRule === 'auto' ? natural * format.lineSpacing
    : format.lineRule === 'exact' && format.lineSpacing !== 0 ? format.lineSpacing * 4 / 3
      : Math.max(natural, format.lineSpacing * 4 / 3);
  // Before-spacing is ignored for this mark's allocation, including when
  // earlier paragraphs exist, but its resolved after-spacing is retained.
  return line + format.spaceAfter * 4 / 3;
}

// Local x follows the reading direction; local y advances to the next line.
// Inputs are allocated cell fragments with resolved border/margin geometry.
export function rotatedCellFrame(box, direction, alignment = 'top', contentHeight = 0, compatibilityMode = 12) {
  if (!['btLr', 'tbRl'].includes(direction)) throw new Error('Unsupported rotated cell direction.');
  const upward = direction === 'btLr';
  const leading = upward ? 'left' : 'right', trailing = upward ? 'right' : 'left';
  const width = Math.max(0, box.height - (box.margins.top + box.margins.bottom) / 15);
  // Compatibility mode 15 reserves both cell margins. Earlier compatibility modes end
  // at the trailing inner border, ignoring that side's declared padding.
  const trailingInset = Math.max(tableBorderWidth(box.borders?.[trailing]) / 2,
    compatibilityMode >= 15 ? box.margins[trailing] / 15 : 0);
  const height = Math.max(0, box.width - box.margins[leading] / 15 - trailingInset);
  const shift = Math.max(0, height - contentHeight) * (alignment === 'center' ? .5 : alignment === 'bottom' ? 1 : 0);
  const matrix = upward
    ? [0, -1, 1, 0, box.x + box.margins.left / 15 + shift, box.y + box.height - box.margins.bottom / 15]
    : [0, 1, -1, 0, box.x + box.width - box.margins.right / 15 - shift, box.y + box.margins.top / 15];
  return { width, height, matrix };
}

export function cellTextPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function cellTextLocalPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix, determinant = a * d - b * c;
  return { x: (d * (x - e) - c * (y - f)) / determinant, y: (-b * (x - e) + a * (y - f)) / determinant };
}

export function cellTextRect(matrix, rect) {
  const first = cellTextPoint(matrix, rect.x, rect.y);
  const last = cellTextPoint(matrix, rect.x + rect.width, rect.y + rect.height);
  return { ...rect, x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), width: Math.abs(last.x - first.x), height: Math.abs(last.y - first.y) };
}

// Resolve after section columns, outer-cell alignment and floating-table
// translations. These operations move physical cells, not local text axes.
export function finishRotatedCells(layout) {
  if (!layout.hasRotatedCells) return layout;
  const rotated = layout.cells.filter(cell => cell.layoutRotated);
  if (!rotated.length) return layout;
  const ids = new Set(), lines = [], repeatedLines = [];
  for (const cell of rotated) {
    if (ids.has(cell.id) && !cell.repeatedHeader) throw new UnsupportedRotatedCellError('Rotated cells spanning physical pages require additional layout support.', cell.id);
    ids.add(cell.id);
    const { local, matrix, geometry } = cell.layoutRotated(cell);
    for (const line of local.lines) {
      // Upright pictures are positioned from the physical top of both text
      // directions. Text before the picture advances that physical Y, even
      // for btLr, whose glyphs themselves read upward from the cell bottom.
      const fragments = line.fragments.map(fragment => {
        if (!fragment.image || isPositionedImage(fragment.image)) return fragment;
        const extent = imageExtents(fragment.image), width = extent.width / EMU_PER_PX, height = extent.height / EMU_PER_PX;
        const top = line.baseline - fragment.ascent;
        const frame = { x: matrix[4] + matrix[2] * top - (matrix[2] < 0 ? width : 0),
          y: cell.y + cell.margins.top / 15 + fragment.x, width, height };
        return { ...fragment, uprightImage: frame };
      });
      const first = Math.min(...line.stops.map(stop => stop.x)), last = Math.max(...line.stops.map(stop => stop.x));
      const bounds = cellTextRect(matrix, { x: first, y: line.y, width: last - first, height: line.height });
      const physicalPage = layout.pages?.[cell.page] || layout.page;
      const physical = { ...line, ...bounds, page: cell.page, region: cell.region, column: cell.column, cellId: cell.id,
        baseline: cellTextPoint(matrix, first, line.baseline).y,
        cellText: { line: { ...line, fragments, page: cell.page, region: cell.region }, matrix, geometry },
        stops: line.stops.map(stop => ({ ...stop, ...cellTextPoint(matrix, stop.x, line.baseline) })),
        fragments: fragments.map(fragment => ({ ...fragment, ...(fragment.uprightImage || cellTextRect(matrix, {
          x: fragment.x, y: line.baseline - fragment.ascent, width: fragment.width, height: fragment.ascent + fragment.descent,
        })) })),
        paragraphFrame: undefined, paragraphBackground: undefined,
        cellClip: intersectCellClip(intersectCellClip({ left: cell.x, right: cell.x + cell.width, top: cell.y, bottom: cell.y + cell.height }, cell.cellClip), { left: 0, right: physicalPage.width, top: 0, bottom: physicalPage.height }),
        ...(cell.header ? { header: true, repeatedHeader: cell.repeatedHeader } : {}),
      };
      (cell.repeatedHeader ? repeatedLines : lines).push(physical);
    }
  }
  return { ...layout,
    lines: [...layout.lines.filter(line => !ids.has(line.cellId)), ...lines].sort((a, b) => a.start - b.start || a.page - b.page),
    repeatedLines: [...layout.repeatedLines.filter(line => !ids.has(line.cellId)), ...repeatedLines].sort((a, b) => a.page - b.page || a.start - b.start),
    cells: layout.cells.map(cell => { if (!cell.layoutRotated) return cell; const { layoutRotated, ...physical } = cell; return physical; }),
  };
}
