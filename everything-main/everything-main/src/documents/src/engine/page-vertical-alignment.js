import { pageBounds } from './page-bounds.js';
import { paragraphFormat } from './model.js';
import { borderOutset } from './paragraph-borders.js';

const shiftClip = (clip, dy) => ({ ...clip,
  ...(clip.top === undefined ? {} : { top: clip.top + dy }),
  ...(clip.bottom === undefined ? {} : { bottom: clip.bottom + dy }),
});
const shift = (item, dy) => {
  const moved = { ...item, y: item.y + dy };
  if (item.baseline !== undefined) moved.baseline = item.baseline + dy;
  for (const key of ['cellClip', 'textClip']) if (item[key]) moved[key] = shiftClip(item[key], dy);
  return moved;
};

/** Align after wrapping converges so floating tables retain their body clearance. */
export function alignPageBody(result, paragraphs, tables) {
  if (!result.pages.some(p => p.verticalAlignment && p.verticalAlignment !== 'top' && !p.storyKind)) return result;
  const byParagraph = new Map(paragraphs.map(p => [p.id, p]));
  const owners = new Map(tables.flatMap(t => t.rows.flatMap(r => r.cells.map(c => [c.id, t]))));
  const rootTable = cellId => {
    let table = owners.get(cellId);
    while (table?.parentCellId) table = owners.get(table.parentCellId);
    return table?.id;
  };
  const floating = new Map((result.floatingTables || []).map(f => [`${f.page}:${f.tableId}`, f]));
  const paragraphFrames = new Map((result.paragraphFrames || []).map(f => [f.frameId, f]));
  const anchors = new Map(result.lines.filter(l => !l.cellId).map(l => [`${l.page}:${l.start}`, l.paragraphId]));
  const key = item => {
    if (item.frameId) {
      const frame = paragraphFrames.get(item.frameId);
      return frame.vAnchor === 'text' ? `p:${frame.anchorId}` : 'fixed-frame';
    }
    if (!item.cellId && !item.tableId) return `p:${item.paragraphId}`;
    const tableId = rootTable(item.cellId || item.id) || item.tableId, frame = floating.get(`${item.page}:${tableId}`);
    if (frame) return frame.position.vertAnchor === 'text' ? `p:${anchors.get(`${frame.page}:${frame.start}`)}` : 'fixed-table';
    return `t:${tableId}`;
  };
  const shifts = new Map();
  let finalShift = 0;
  for (let index = 0; index < result.pageCount; index++) {
    const page = result.pages[index], alignment = page.verticalAlignment || 'top';
    if (alignment === 'top' || page.storyKind) continue;
    const region = result.pageRegions[index]?.at(-1);
    const bounds = region?.alignmentBounds || pageBounds(page, index), groups = new Map();
    const lines = result.lines.filter(l => l.page === index && !l.virtual);
    const cells = result.cells.filter(c => c.page === index);
    for (const item of [...lines.filter(l => !l.frameId), ...cells]) {
      const id = key(item), group = groups.get(id) || { id, top: Infinity, bottom: bounds.top };
      group.top = Math.min(group.top, item.y);
      group.bottom = Math.max(group.bottom, Math.min(item.y + item.height, item.cellClip?.bottom ?? Infinity));
      groups.set(id, group);
    }
    const ordered = [...groups.values()].filter(g => g.id !== 'fixed-table').sort((a,b) => a.top - b.top);
    if (!ordered.length) continue;
    let bottom = Math.max(...ordered.map(g => g.bottom));
    const sectionEnd = index === result.pageCount - 1 || result.pageSections[index] !== result.pageSections[index + 1];
    if (sectionEnd) bottom = Math.max(bottom, region?.bottom || 0);
    else {
      const last = lines.at(-1);
      if (last?.paragraphEnd && !last.cellId) {
        const format = paragraphFormat(byParagraph.get(last.paragraphId));
        bottom += format.spaceAfter * 4 / 3 + borderOutset(format.paragraphBorders.bottom);
      }
    }
    const spare = Math.max(0, bounds.bottom - bottom);
    const uniform = alignment === 'center' ? spare / 2 : alignment === 'bottom' ? spare : 0;
    shifts.set(`${index}:fixed-table`, uniform);
    shifts.set(`${index}:virtual`, uniform || (alignment === 'both' && ordered.length > 1 ? spare : 0));
    ordered.forEach((group, i) => shifts.set(`${index}:${group.id}`, uniform || (alignment === 'both' && ordered.length > 1 ? spare * i / (ordered.length - 1) : 0)));
    if (index === result.pageCount - 1) finalShift = uniform || (alignment === 'both' && ordered.length > 1 ? spare : 0);
  }
  const move = item => shift(item, shifts.get(`${item.page}:${key(item)}`) ?? (item.virtual ? shifts.get(`${item.page}:virtual`) || 0 : 0));
  const frames = (result.floatingTables || []).map(frame => {
    const dy = shifts.get(`${frame.page}:${key(frame)}`) || 0;
    return { ...frame, top: frame.top + dy, bottom: frame.bottom + dy };
  });
  const objects = (result.floatingObjects || []).map(frame => {
    const anchor = result.lines.find(l => l.page === frame.page && l.start <= frame.start && l.end >= frame.start);
    const dy = anchor ? shifts.get(`${frame.page}:${key(anchor)}`) || 0 : 0;
    return { ...frame, y: frame.y + dy };
  });
  return { ...result, lines: result.lines.map(move), cells: result.cells.map(move), repeatedLines: result.repeatedLines.map(move),
    paragraphFrames: (result.paragraphFrames || []).map(frame => { const dy = shifts.get(`${frame.page}:${key(frame)}`) || 0; return { ...frame, top: frame.top + dy, bottom: frame.bottom + dy }; }),
    floatingTables: frames, floatingObjects: objects, endY: result.endY + finalShift };
}
