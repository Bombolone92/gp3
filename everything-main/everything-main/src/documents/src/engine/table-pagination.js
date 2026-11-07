import { alignCellContent } from './cell-alignment-layout.js';
import { blockMinimumHeight } from './block-layout.js';
import { borderOutset } from './paragraph-borders.js';
import { intersectCellClip } from './cell-clipping.js';
import { pageBounds, cellPageAt } from './page-bounds.js';
// Original table placement. Text flows independently in each owning cell;
// row boundaries constrain the full rectangles, including vertical continuations.
export function paginateTableRows(rows, page, maxPages, startY, paginateText) {
  let hints;
  for (let attempt = 0; attempt <= rows.length + 1; attempt++) {
    const result = paginateTableRowsPass(rows, page, maxPages, startY, paginateText, hints);
    if (!page.pageBounds || rows.every((row, i) => {
      if (row.fixedHeight == null) return true;
      const capacity = part => { const b = pageBounds(page, part); return b.bottom - (page.tablePageTops?.[part] ?? b.top); };
      return (row.fixedHeight > capacity(hints?.[i]?.start.page || 0)) === (row.fixedHeight > capacity(result.rowBounds[i].start.page));
    })) return result;
    hints = result.rowBounds;
  }
  throw new Error('Table clipping did not converge with changing page-story bounds.');
}
function paginateTableRowsPass(rows, page, maxPages, startY, paginateText, hints) {
  const pageBottom = part => pageBounds(page, part).bottom;
  const pageTop = part => page.tablePageTops?.[part] ?? pageBounds(page, part).top;
  const pageCapacity = part => pageBottom(part) - pageTop(part);
  // A physical table fragment starts inside its painted top border. Body rows
  // below a repeated header share that header's boundary instead.
  const belowHeader = part => page.tableBodyBelowHeader || page.tablePageTops?.[part] != null;
  const continuationEdge = (row, part) => belowHeader(part) ? 0 : row.pageTopEdge ?? row.topEdge ?? 0;
  const continuationInset = (row, part) => belowHeader(part) ? 0 : continuationEdge(row, part) - (row.topEdge || 0);
  const startsFragment = (row, start) => !belowHeader(start.page) && start.y <= pageTop(start.page) + continuationEdge(row, start.page) + 1e-6;
  // At a page cut the cell's bottom ink fits wholly inside the writing area.
  // The logical row boundary only reserves half a shared border; an interior
  // row also falls back to the table's outer bottom border on a new fragment.
  const cellPageBottom = cell => cell.page.bottom - cell.margins.bottom / 15 + (cell.pageBottomInset ?? cell.margins.bottom / 15);
  const cellBottom = (cell, part) => pageBounds(cellPageAt({ ...cell.page, bottom: cellPageBottom(cell) }, page, 0), part).bottom;
  const flowHeight = (start, end) => {
    // A merged cell may have finished before a following row moved pages.
    // Its completed content imposes no remaining height on that row, including
    // when page stories give each physical page different writing bounds.
    if (end.page < start.page || end.page === start.page && end.y <= start.y) return 0;
    if ((!page.tablePageTops && !page.pageBounds) || start.page === end.page) return (end.page - start.page) * pageCapacity(start.page) + end.y - start.y;
    let height = pageBottom(start.page) - start.y;
    for (let part = start.page + 1; part < end.page; part++) height += pageBottom(part) - pageTop(part);
    return height + end.y - pageTop(end.page);
  };
  const later = (a, b) => a.page > b.page || a.page === b.page && a.y > b.y ? a : b;
  const check = point => {
    if (point.page >= maxPages) throw new Error(`This preview supports up to ${maxPages} pages. Reduce the document length or adjust its formatting.`);
    return point;
  };
  const extend = (start, height) => {
    if (page.tablePageTops || page.pageBounds) {
      let part = start.page, top = start.y;
      while (height > pageBottom(part) - top + 1e-6) {
        height -= Math.max(0, pageBottom(part) - top); check({ page: ++part }); top = pageTop(part);
      }
      return { page: part, y: Math.min(pageBottom(part), top + height) };
    }
    const available = pageBottom(start.page) - start.y;
    if (height <= available + 1e-6) return { page: start.page, y: Math.min(pageBottom(start.page), start.y + height) };
    const capacity = pageCapacity(start.page), remaining = height - available, extra = Math.ceil((remaining - 1e-6) / capacity);
    return check({ page: start.page + extra, y: page.top + remaining - (extra - 1) * capacity });
  };
  const bounds = [], owners = [], ending = Array.from({ length: rows.length }, () => []);
  const flexibleCounts = [0];
  for (const row of rows) flexibleCounts.push(flexibleCounts.at(-1) + Number(row.fixedHeight == null));
  const hasFixed = flexibleCounts.at(-1) !== rows.length;
  const legacy = (page.compatibilityMode ?? 12) < 15;
  const oversizedFixed = rows.map((row, i) => row.fixedHeight != null && row.fixedHeight > pageCapacity(hints?.[i]?.start.page || 0));
  const nextOversizedFixed = Array(rows.length + 1).fill(-1);
  for (let i = rows.length - 1; i >= 0; i--) nextOversizedFixed[i] = oversizedFixed[i] ? i : nextOversizedFixed[i + 1];
  // A merge ending in an exact row cannot grow an earlier flexible row.
  // Legacy compatibility modes additionally clip at the first oversized fixed row;
  // mode 15 and later can continue from that row when the merge ends in a flexible row.
  const clipAfterRow = (first, last) => {
    const oversized = legacy ? nextOversizedFixed[first] : -1;
    const candidate = oversized >= first && oversized <= last ? oversized : rows[last].fixedHeight != null ? last : -1;
    return candidate >= first && candidate <= last ? candidate : -1;
  };
  const contentHeight = cell => cell.contentHeight + (cell.margins.top + cell.margins.bottom) / 15;
  const remainingHeight = (index, start, placed) => {
    if (rows[index].fixedHeight != null) return rows[index].fixedHeight;
    if (rows.length === 1 || ![...owners, ...placed].some(c => c.cell.rowSpan > 1 && c.last >= index)) return rows[index].minimumHeight ?? rows[index].minHeight / 15;
    const heights = rows.slice(index).map(row => row.fixedHeight ?? Math.max(row.minimumHeight ?? row.minHeight / 15, ...row.cells.filter(c => c.rowSpan === 1).map(contentHeight)));
    const required = heights[0];
    const grow = (first, last, required) => {
      let total = 0;
      for (let i = first; i <= last; i++) total += heights[i];
      const oversized = heights.findIndex((_, i) => i >= first && i <= last && rows[index + i].fixedHeight == null && rows[index + i].minimumHeight > pageCapacity(hints?.[index + i]?.start.page ?? start.page));
      if (oversized >= 0) { heights[oversized] += Math.max(0, required - total); return; }
      // A merged owner's remaining demand extends its final flexible row.
      // Earlier rows retain the heights required by their own content.
      for (let i = last; i >= first; i--) if (rows[index + i].fixedHeight == null) {
        heights[i] += Math.max(0, required - total); break;
      }
    };
    // Future cells have natural demands. Started cells have actual remaining page
    // extents, so space consumed before a kept row moves is never counted twice.
    for (let r = index + 1; r < rows.length; r++) for (const cell of rows[r].cells) if (cell.rowSpan > 1 && clipAfterRow(r, r + cell.rowSpan - 1) < 0) grow(r - index, r - index + cell.rowSpan - 1, contentHeight(cell));
    for (const owner of [...owners, ...placed]) if (!owner.constrained && owner.last >= index && owner.cell.rowSpan > 1) {
      grow(0, owner.last - index, Math.max(0, flowHeight(start, owner.end)));
    }
    const available = pageBottom(start.page) - start.y;
    // Growth shared with later rows is flexible. It must not force an otherwise
    // fitting kept row forward merely to preserve an equal-height allocation.
    if (rows[index].cantSplit && available > 1e-6 && required <= available && [...owners, ...placed].some(c => c.last > index && flexibleCounts[c.last + 1] > flexibleCounts[index + 1])) return Math.min(heights[0], available);
    return heights[0];
  };
  let cursor = { page: 0, y: startY + (rows[0].beforeEdge || (startY <= pageTop(0) + 1e-6 ? continuationEdge(rows[0], 0) : 0)) };
  for (const [index, row] of rows.entries()) {
    let start = { ...cursor };
    const naturalMinimum = Math.max(0, ...row.cells.map(c => blockMinimumHeight(c.blocks[0]) + (c.margins.top + c.margins.bottom) / 15));
    // A declared minimum reserves fresh-page space even when splitting is
    // permitted. Oversized minimums constrain every physical row fragment.
    const beforeEdge = index === 0 ? rows[0].beforeEdge || 0 : 0;
    const afterEdge = index === rows.length - 1 ? row.afterEdge || 0 : 0;
    const minimumHeight = row.minimumHeight ?? row.minHeight / 15;
    const oversizedMinimum = () => row.fixedHeight == null && minimumHeight > pageCapacity(start.page);
    const fittingMinimum = Math.min(minimumHeight + afterEdge, pageCapacity(start.page) - beforeEdge);
    // A fitting automatic row reserves the exterior half of its bottom ink,
    // including when the following row will share that border on this page.
    const minimum = row.fixedHeight == null ? Math.max(naturalMinimum + Math.max(afterEdge, row.bottomEdge || 0), fittingMinimum) : row.fixedHeight + afterEdge - (row.bottomFitInset || 0);
    const nextPage = () => {
      if (index) for (const owner of owners) if (!owner.constrained && owner.last >= index) {
        // Keep merged text inside the actual row boxes when the next row moves.
        // The unused page gap belongs to neither the row nor the merged cell.
        const localPage = start.page - owner.startPage;
        owner.cellFragments ??= [];
        owner.cellFragments[localPage] = { top: owner.cellFragments[localPage]?.top ?? pageBounds(cellPageAt(owner.cell.page, page, owner.startPage), localPage).top, bottom: bounds[index - 1].end.y - (rows[index - 1].bottomInset ?? owner.cell.margins.bottom / 15) };
        const nextTop = pageTop(start.page + 1) + (row.topInset ?? owner.cell.margins.top / 15) + continuationEdge(row, start.page + 1) + continuationInset(row, start.page + 1);
        owner.cellFragments[localPage + 1] = { top: nextTop, bottom: cellBottom(owner.cell, start.page + 1) };
        owner.result = paginateText(owner.cell.blocks, cellPageAt({ ...owner.cell.page, top: nextTop - (pageBounds(page, start.page + 1).top - page.top), bottom: cellPageBottom(owner.cell), cellFragments: owner.cellFragments }, page, owner.startPage), maxPages - owner.startPage, owner.startY);
        owner.end = { page: owner.startPage + owner.result.pageCount - 1, y: owner.result.endY + owner.cell.margins.bottom / 15 };
      }
      start = check({ page: start.page + 1, y: pageTop(start.page + 1) + (index === 0 && rows[0].beforeEdge || continuationEdge(row, start.page + 1)) });
    };
    if (start.y + minimum > pageBottom(start.page) + 1e-6 && (row.fixedHeight == null || start.y > pageTop(start.page) + beforeEdge + 1e-6)) nextPage();
    const placeCells = () => row.cells.map(cell => {
      const last = index + cell.rowSpan - 1;
      const clippedAfter = clipAfterRow(index, last);
      // Fixed or overflow-clipped spans cannot demand extra space in earlier
      // flexible rows. Allocate their boxes before flowing the retained source.
      if (clippedAfter >= 0 || flexibleCounts[last + 1] === flexibleCounts[index]) return { cell, first: index, last, clippedAfter, constrained: true, end: start };
      let textPage = { ...cell.page, top: cell.page.top + continuationEdge(row, start.page + 1) + continuationInset(row, start.page + 1),
        bottom: cellPageBottom(cell) };
      if (page.tablePageTops) {
        const cellFragments = [];
        for (const [part, top] of Object.entries(page.tablePageTops)) if (+part >= start.page) {
          cellFragments[+part - start.page] = { top: top + cell.margins.top / 15, bottom: cellBottom(cell, +part) };
        }
        textPage = { ...textPage, cellFragments };
      }
      const textStart = start.y + cell.margins.top / 15 + (startsFragment(row, start) ? continuationInset(row, start.page) : 0);
      textPage = cellPageAt(textPage, page, start.page);
      const result = paginateText(cell.blocks, textPage, maxPages - start.page, textStart);
      return { cell, first: index, last, startPage: start.page, startY: textStart, result, cellFragments: textPage.cellFragments,
        end: { page: start.page + result.pageCount - 1, y: result.endY + cell.margins.bottom / 15 } };
    });
    const endRow = placed => {
      // Exact rows occupy one physical page, even when their declared extent
      // crosses the paper edge. Source text remains available beneath its clip.
      const insetChange = startsFragment(row, start) ? continuationInset(row, start.page) : 0;
      let end = row.fixedHeight != null ? { page: start.page, y: start.y + row.fixedHeight + insetChange }
        : oversizedMinimum() ? { page: start.page, y: pageBottom(start.page) - (row.bottomEdge || 0) }
        : extend(start, remainingHeight(index, start, placed) + insetChange);
      if (row.fixedHeight == null) for (const owner of [...ending[index], ...placed.filter(c => c.last === index)]) if (!owner.constrained) end = later(end, owner.end);
      if (oversizedMinimum()) end = { ...end, y: pageBottom(end.page) - (row.bottomEdge || 0) };
      return end;
    };
    let placed = placeCells(), end = endRow(placed);
    const freshTop = pageTop(start.page) + (index === 0 && rows[0].beforeEdge || continuationEdge(row, start.page));
    // A row made entirely of merge continuations has no new content to keep.
    // Moving it would detach an already-started owner from a kept heading.
    // First-line height alone cannot predict paragraph keeps or retained cell
    // after-spacing. Every owning cell starts before splitting a row;
    // otherwise move the row, including its borders, to the next page.
    if (row.cells.length && end.page > start.page && start.y > freshTop + 1e-6 &&
      // The first paragraph of the first physical cell also acts as a
      // row split keep. Later cell/paragraph flags retain only their local role.
      (row.cantSplit || row.cells[0]?.column === 0 && row.cells[0]?.blocks[0]?.format.keepNext || placed.some(owner => !owner.constrained && owner.result.lines.find(line => !line.virtual)?.page > 0))) {
      nextPage(); placed = placeCells(); end = endRow(placed);
    }
    for (const owner of placed) { owners.push(owner); if (owner.last > index) ending[owner.last].push(owner); }
    bounds.push({ start, end }); cursor = end;
  }
  // A split automatic row ends at its fitted content, not at the unused
  // writing-area limit. All cells in that physical row share the same edge.
  // Exact/oversized allocations keep their declared constraints.
  const splitEnds = bounds.map((bound, index) => {
    const row = rows[index];
    if (bound.start.page === bound.end.page || row.fixedHeight != null || row.minimumHeight > pageCapacity(bound.start.page)) return null;
    return new Map(Array.from({ length: bound.end.page - bound.start.page }, (_, offset) => {
      const part = bound.start.page + offset;
      return [part, offset ? pageTop(part) + continuationEdge(row, part) : bound.start.y + (row.minimumHeight ?? row.minHeight / 15)];
    }));
  });
  if (splitEnds.some(Boolean)) for (const owner of owners) {
    const affected = [];
    for (let index = owner.first; index <= owner.last; index++) if (splitEnds[index]) {
      // A span clipped by an exact-height row uses its allocated rectangles.
      if (owner.constrained) splitEnds[index] = null;
      else affected.push(index);
    }
    if (!affected.length) continue;
    const ends = new Map();
    const add = (part, end) => ends.set(part + owner.startPage, Math.max(ends.get(part + owner.startPage) || 0, end));
    for (const line of owner.result.lines) if (!line.virtual) add(line.page, line.y + line.height +
      (line.paragraphAfter || 0) + borderOutset(line.paragraphFrame?.borders.bottom));
    for (const box of owner.result.cells || []) add(box.page, box.y + box.height);
    for (const index of affected) for (const [part, end] of splitEnds[index]) {
      const content = ends.get(part);
      if (content != null) splitEnds[index].set(part, Math.min(pageBottom(part), Math.max(end, content + (rows[index].bottomInset ?? owner.cell.margins.bottom / 15))));
    }
  }
  const rowBottom = (index, part) => splitEnds[index]?.get(part) ?? pageBottom(part);
  const lines = [], cells = [], repeatedLines = [];
  for (const owner of owners) {
    const { cell } = owner, start = bounds[owner.first].start, end = bounds[owner.last].end;
    const fragments = [];
    for (let part = start.page; part <= end.page; part++) {
      let fragmentRow = rows[owner.first], fragmentLastRow = rows[owner.last];
      let top = part === start.page ? start.y : pageTop(part) + continuationEdge(rows[owner.first], part), edge = part === end.page ? end.y : rowBottom(owner.last, part);
      if (owner.first === owner.last && rows[owner.first].fixedHeight == null && rows[owner.first].minimumHeight > pageCapacity(part)) {
        edge = pageBottom(part) - (rows[owner.first].bottomEdge || 0);
      }
      if (owner.last > owner.first && (hasFixed || end.page > start.page)) {
        const ranges = bounds.slice(owner.first, owner.last + 1).map((b, offset) => {
          const row = rows[owner.first + offset];
          const oversized = row.fixedHeight == null && row.minimumHeight > pageCapacity(part);
          return { ...b, row,
            top: b.start.page === part ? b.start.y : pageTop(part) + continuationEdge(row, part),
            bottom: b.end.page === part ? b.end.y : rowBottom(owner.first + offset, part) - (oversized ? row.bottomEdge || 0 : 0) };
        }).filter(b => b.start.page <= part && b.end.page >= part);
        if (!ranges.length) continue;
        top = Math.min(...ranges.map(b => b.top));
        fragmentRow = ranges.find(b => b.top === top).row;
        edge = Math.max(...ranges.map(b => b.bottom));
        fragmentLastRow = ranges.findLast(b => b.bottom === edge).row;
      }
      // An exact row can collapse when its shared top border disappears at a
      // page cut. Keep a zero-height clip so its editable source is not lost.
      if (edge < top - 1e-6 || edge <= top + 1e-6 && !owner.constrained) continue;
      const pageStart = startsFragment(fragmentRow, { page: part, y: top });
      const borders = pageStart ? { ...cell.borders, top: fragmentRow.pageTopBorders?.[cell.column] ?? cell.pageTopBorder ?? cell.borders.top } : cell.borders;
      const borderInsets = { top: pageStart ? continuationEdge(fragmentRow, part) : fragmentRow.topEdge || 0, bottom: fragmentLastRow.bottomEdge || 0 };
      const sideBorders = cell.rowSideBorders?.flatMap((borders, offset) => {
        const index = owner.first + offset, range = bounds[index], row = rows[index];
        if (range.start.page > part || range.end.page < part) return [];
        const begin = Math.max(top, range.start.page === part ? range.start.y : pageTop(part) + continuationEdge(row, part));
        const finish = Math.min(edge, range.end.page === part ? range.end.y : rowBottom(index, part));
        return finish > begin ? [{start: begin - top, end: finish - top, ...borders}] : [];
      });
      fragments.push({ id: cell.id, tableId: cell.tableId, rowId: cell.rowId, depth: cell.depth, page: part, x: cell.x, tableOffsetX: cell.tableOffsetX, y: top, width: cell.width, height: Math.max(0, edge - top), fill: cell.fill, borders, borderInsets, margins: cell.margins,
        ...(cell.layoutRotated ? { layoutRotated: cell.layoutRotated } : {}),
        ...(cell.fillPadding ? {
          fillTopInset: part === start.page ? 0 : Math.max(0, (fragmentRow.paddingTop || 0) - cell.fillPadding.top),
          fillBottomInset: (fragmentLastRow.paddingBottom || 0) - cell.fillPadding.bottom,
        } : {}),
        ...(fragmentLastRow.pageBottomBorders?.[cell.column] ? {pageBottomBorder: fragmentLastRow.pageBottomBorders[cell.column]} : {}),
        ...(sideBorders ? {sideBorders} : {}),
        ...(cell.floatingTable ? { floatingTable: cell.floatingTable } : {}) });
    }
    let { result, startPage } = owner;
    if (owner.constrained) {
      startPage = start.page;
      const textFragments = owner.clippedAfter >= 0 ? fragments.filter(box => box.page <= bounds[owner.clippedAfter].end.page) : fragments;
      const cellFragments = textFragments.map(box => ({ top: box.y + cell.margins.top / 15 + (startsFragment(rows[owner.first], { page: box.page, y: box.y }) ? continuationInset(rows[owner.first], box.page) : 0), bottom: box.y + box.height - cell.margins.bottom / 15 }));
      result = paginateText(cell.blocks, cellPageAt({ ...cell.page, clipOverflow: cell.page.clipOverflow || owner.clippedAfter >= 0, cellFragments }, page, start.page), maxPages - start.page, cellFragments[0].top);
    }
    cells.push(...fragments);
    const alignedContent = alignCellContent({ ...cell, page: cellPageAt(cell.page, page, 0) }, result, startPage, fragments), aligned = alignedContent.lines;
    // Indivisible inline content stays at its natural size when AutoFit
    // reaches the available width, but clips its ink at the cell boundary.
    // Keep this separate from exact-row vertical clipping and nested tables.
    for (const line of [...aligned, ...alignedContent.repeatedLines]) {
      if (line.fragments.some(fragment => fragment.x < cell.x || fragment.x + fragment.width > cell.x + cell.width)) {
        line.cellClip = intersectCellClip(line.cellClip, { left: cell.x, right: cell.x + cell.width, top: 0, bottom: page.height });
      }
    }
    const fixedOverflow = nextOversizedFixed[owner.first];
    if (owner.constrained || fixedOverflow >= owner.first && fixedOverflow <= owner.last) {
      const horizontalOverflow = alignedContent.cells.some(box => box.x < cell.x || box.x + box.width > cell.x + cell.width);
      const clips = new Map(fragments.map(box => {
        // Exact row allocation can extend beyond the paper, but painting and
        // editing must share the physical page's visible clipping boundary.
        const bottom = Math.min(page.height, Math.max(box.y, box.y + box.height - cell.margins.bottom / 15));
        const top = box.height === 0 ? bottom : Math.min(bottom, box.y + cell.margins.top / 15 + (startsFragment(rows[owner.first], { page: box.page, y: box.y }) ? continuationInset(rows[owner.first], box.page) : 0));
        return [box.page, { top, bottom, ...(horizontalOverflow ? { left: box.x, right: box.x + box.width } : {}) }];
      }));
      for (const item of [...aligned, ...alignedContent.repeatedLines, ...alignedContent.cells]) {
        const clip = clips.get(item.page);
        if (clip) item.cellClip = intersectCellClip(item.cellClip, clip);
      }
    }
    cells.push(...alignedContent.cells); repeatedLines.push(...alignedContent.repeatedLines);
    lines.push(...aligned);
  }
  return { lines, cells, repeatedLines, rowBounds: bounds, pageCount: cursor.page + 1, endY: cursor.y + (rows.at(-1).afterEdge || 0) };
}
