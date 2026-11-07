import { borderWidth, borderOutset, sameParagraphBorders } from './paragraph-borders.js';
import { intersectCellClip } from './cell-clipping.js';
import { compoundBorderMetrics, borderBands } from './border-patterns.js';
import { joinTableBorderCorner } from './table-border-corners.js';

const spacing = border => borderWidth(border) ? border.space * 4 / 3 : 0;
const joins = (a, b) => a?.frame && b?.frame && a.cellId === b.cellId && a.frameId === b.frameId && a.column === b.column && sameParagraphBorders(a.frame.borders, b.frame.borders);

/** Place border ink only after page/cell layout. Every group is one physical
 * paragraph fragment; plain paragraphs and different cells interrupt joining. */
export function layoutParagraphBorders(layout) {
  const groups = new Map(), strokes = [];
  for (const line of [...layout.lines, ...(layout.repeatedLines || [])]) {
    const key = `${line.page}:${line.column ?? 0}:${line.paragraphId}`;
    if (!groups.has(key)) groups.set(key, { paragraphId: line.paragraphId, page: line.page, column: line.column, cellId: line.cellId, ...(line.frameId ? { frameId: line.frameId } : {}), start: line.start, top: Infinity, bottom: -Infinity, lines: [], frame: line.paragraphFrame });
    const group = groups.get(key); group.lines.push(line); group.start = Math.min(group.start, line.start);
    if (!line.virtual) { group.top = Math.min(group.top, line.y); group.bottom = Math.max(group.bottom, line.y + line.height); }
  }
  const frames = new Map((layout.paragraphFrames || []).map(frame => [frame.frameId, frame]));
  for (const group of groups.values()) {
    const frame = frames.get(group.frameId);
    if (frame && group.frame && frame.paragraphIds.at(-1) === group.paragraphId) {
      group.bottom = Math.max(group.bottom, frame.bottom - borderOutset(group.frame.borders.bottom));
    }
  }
  const junction = (a, b) => {
    const width = borderWidth(a.frame.borders.between), distance = spacing(a.frame.borders.between), gap = b.top - a.bottom;
    const after = a.frame.contextualSpacing && a.frame.styleId === b.frame.styleId ? 0 : a.frame.spaceAfter;
    const y = a.bottom + distance + Math.min(Math.max(0, gap - width - 2 * distance), after);
    return { y, width, center: y + width / 2 };
  };
  for (let index = 0; index < layout.pageCount; index++) {
    const content = [...groups.values()].filter(g => g.page === index).sort((a, b) => a.start - b.start);
    for (const [i, group] of content.entries()) {
      if (!group.frame) continue;
      const { borders, x, right } = group.frame, previous = content[i - 1], next = content[i + 1];
      const above = joins(previous, group) ? junction(previous, group) : null;
      const below = joins(group, next) ? junction(group, next) : null;
      const inner = { left: x - spacing(borders.left), right: right + spacing(borders.right), top: above?.center ?? group.top - spacing(borders.top), bottom: below?.center ?? group.bottom + spacing(borders.bottom) };
      const outer = { left: inner.left - borderWidth(borders.left), right: inner.right + borderWidth(borders.right), top: inner.top - (above ? 0 : borderWidth(borders.top)), bottom: inner.bottom + (below ? 0 : borderWidth(borders.bottom)) };
      const cell = layout.cells.find(c => c.id === group.cellId && c.page === index && c.column === group.column);
      // Paragraph decoration is clipped at its cell, even when border distance
      // places the vertical edges outside that cell. Keep the authored frame.
      const cellClip = intersectCellClip(group.lines[0].cellClip, cell ? { left: cell.x, right: cell.x + cell.width, top: cell.y, bottom: cell.y + cell.height } : undefined);
      const frameStrokes = {};
      const add = (side, box, horizontal, clip) => {
        const border = borders[side]; if (!borderWidth(border) || box.width <= 0 || box.height <= 0) return;
        const stroke = { ...box, side, border, horizontal, clip, ...(cellClip ? { cellClip } : {}), page: index, paragraphId: group.paragraphId, ...(group.frameId ? { frameId: group.frameId } : {}), cellId: group.cellId, background: cell?.fill || '#FFFFFF' };
        strokes.push(stroke); frameStrokes[side] = stroke;
      };
      if (!above) add('top', { x: outer.left, y: outer.top, width: outer.right - outer.left, height: borderWidth(borders.top) }, true,
        [[outer.left, outer.top], [outer.right, outer.top], [inner.right, inner.top], [inner.left, inner.top]]);
      if (!below) add('bottom', { x: outer.left, y: inner.bottom, width: outer.right - outer.left, height: borderWidth(borders.bottom) }, true,
        [[inner.left, inner.bottom], [inner.right, inner.bottom], [outer.right, outer.bottom], [outer.left, outer.bottom]]);
      add('left', { x: outer.left, y: outer.top, width: borderWidth(borders.left), height: outer.bottom - outer.top }, false,
        [[outer.left, outer.top], [inner.left, inner.top], [inner.left, inner.bottom], [outer.left, outer.bottom]]);
      add('right', { x: inner.right, y: outer.top, width: borderWidth(borders.right), height: outer.bottom - outer.top }, false,
        [[inner.right, inner.top], [outer.right, outer.top], [outer.right, outer.bottom], [inner.right, inner.bottom]]);
      // Native small/medium compound controls have rectangular band joins,
      // rather than a diagonal cut through mismatched inner/outer bands.
      for (const hSide of ['top', 'bottom']) for (const vSide of ['left', 'right']) {
        const h = frameStrokes[hSide], v = frameStrokes[vSide];
        if (!h || !v || !compoundBorderMetrics(h.border) || !compoundBorderMetrics(v.border)) continue;
        if (!borderBands(h.border, h.height, hSide) || !borderBands(v.border, v.width, vSide)) continue;
        delete h.clip; delete v.clip;
        joinTableBorderCorner([{ stroke:h, first:vSide === 'left' }, { stroke:v, first:hSide === 'top' }]);
      }
      if (below) {
        const nextLeft = next.frame.x - spacing(borders.left) - borderWidth(borders.left), nextRight = next.frame.right + spacing(borders.right) + borderWidth(borders.right);
        add('between', { x: Math.min(outer.left, nextLeft), y: below.y, width: Math.max(outer.right, nextRight) - Math.min(outer.left, nextLeft), height: below.width }, true);
        // Identical border declarations also join paragraphs with different
        // indents. Horizontal steps connect the corresponding vertical edges.
        for (const side of ['left', 'right']) {
          const width = borderWidth(borders[side]);
          const a = side === 'left' ? outer.left + width / 2 : outer.right - width / 2;
          const b = side === 'left' ? nextLeft + width / 2 : nextRight - width / 2;
          if (a !== b) add(side, { x: Math.min(a, b), y: below.center - width / 2, width: Math.abs(b - a), height: width }, true);
        }
      }
      // Shading reaches the inside edge of the paragraph border. Dividers are
      // painted above the meeting fills, including differently shaded members.
      const painted = group.lines.filter(line => line.paragraphBackground);
      for (const line of painted) {
        line.paragraphBackground = { ...line.paragraphBackground, x: inner.left, width: inner.right - inner.left, before: 0, after: 0 };
      }
      if (painted.length) {
        painted[0].paragraphBackground.before = painted[0].y - inner.top;
        const last = painted.at(-1); last.paragraphBackground.after = inner.bottom - last.y - last.height;
      }
    }
  }
  return strokes;
}
