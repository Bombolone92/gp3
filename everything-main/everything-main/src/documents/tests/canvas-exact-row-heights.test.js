import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects, imageAtPoint, verticalLine, lineAtPosition } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { paragraphBackgrounds } from '../src/engine/paragraph-backgrounds.js';
import { rowHeight } from '../src/engine/row-height.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/exact-row-heights.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const exact = value => ({ rule: 'exact', value });
function sameParts(a, b, except = []) { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key of Object.keys(a)) if (!except.includes(key)) expect(Buffer.from(a[key]).equals(Buffer.from(b[key])), key).toBe(true); }

it('reads inherited exact heights and adds the largest bottom padding without changing declared values', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), placed = layout(doc), row = doc.tables[0].rows[0];
  expect(rowHeight(row)).toEqual(exact(480)); expect(row.heightExplicit).toBe(false);
  expect(row.inheritedRowHeight).toEqual(exact(480));
  for (const cell of row.cells) expect(placed.cells.find(c => c.id === cell.id).height).toBeCloseTo((480 + 150) / 15);
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('retains hidden text and Unicode through editing, exact-height changes, undo and export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), original = doc.snapshot();
  select(doc, 'HIDDEN TWO'); const before = layout(doc); doc.replace('REVISED HIDDEN Á😀');
  const edited = layout(doc); expect(edited.cells).toEqual(before.cells); expect(edited.pageCount).toBe(before.pageCount);
  select(doc, 'Exact visible'); doc.setTableRowHeight(exact(720));
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text); expect(rowHeight(reopened.tables[0].rows[0])).toEqual(exact(720));
  expectBodyEditParts(unzipSync(bytes), pkg.parts);
  doc.undo(); doc.undo(); expect(doc.text).toBe(original.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'));
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); expect(doc.text).toBe(reopened.text);
});

it('clips selections and carets, ignores hidden hit targets and navigates to the following row', async () => {
  const doc = model(await DocxPackage.open(source)), placed = layout(doc); select(doc, 'HIDDEN TWO');
  const hidden = lineAtPosition(placed, doc.range[0]), box = placed.cells.find(c => c.id === hidden.cellId);
  expect(hidden.y).toBeGreaterThanOrEqual(hidden.cellClip.bottom);
  expect(selectionRects(placed, ...doc.range)).toEqual([]);
  const caret = caretRect(placed, doc.range[0]); expect(caret.y + caret.height).toBeLessThanOrEqual(hidden.cellClip.bottom);
  const visible = hitTest(placed, box.page, box.x + 10, box.y + box.height - 1);
  expect(visible).toBeLessThan(doc.range[0]);
  const next = verticalLine(placed, hidden, 1, caret.x);
  expect(next.cellId).toBe(doc.tables[0].rows[1].cells[0].id);
  select(doc, 'Following automatic row'); const nextCaret = caretRect(placed, doc.range[0]);
  expect(hitTest(placed, nextCaret.page, nextCaret.x, nextCaret.y + nextCaret.height / 2)).toBe(doc.range[0]);
});

it('clips images, paragraph shading, border ink and decorations to the fixed cell', async () => {
  const doc = model(await DocxPackage.open(source)), placed = layout(doc), pictureId = doc.tables[0].rows[2].cells[0].id;
  const line = placed.lines.find(l => l.cellId === pictureId), image = line.fragments.find(f => f.image), box = placed.cells.find(c => c.id === pictureId);
  expect(box.height).toBeCloseTo(48);
  expect(imageAtPoint(placed, line.page, image.x + 5, box.y + 5)).toBe(image);
  expect(imageAtPoint(placed, line.page, image.x + 5, box.y + box.height + 5)).toBeNull();
  const rectangles = selectionRects(placed, image.start, image.end);
  expect(rectangles.length).toBeGreaterThan(0); expect(rectangles.every(r => r.y >= box.y && r.y + r.height <= box.y + box.height)).toBe(true);
  const decoratedId = doc.tables[0].rows[4].cells[0].id, decorated = placed.lines.filter(l => l.cellId === decoratedId), clip = decorated[0].cellClip;
  const backgrounds = paragraphBackgrounds(decorated, placed.page, placed.cells);
  for (const { rect } of backgrounds.values()) if (rect) expect(rect.y + rect.height).toBeLessThanOrEqual(clip.bottom);
  const borders = placed.paragraphBorders.filter(b => b.cellId === decoratedId);
  expect(borders.length).toBeGreaterThan(0); expect(borders.every(b => b.cellClip.top === clip.top && b.cellClip.bottom === clip.bottom)).toBe(true);
  expect(decorated.some(l => l.underlines.length && l.strikes.length)).toBe(true);
});

it('keeps exact-ending merges fixed and clips retained overflow', async () => {
  const doc = model(await DocxPackage.open(source)), placed = layout(doc);
  const fixed = doc.tables[1], mixed = doc.tables[2];
  const total = id => placed.cells.filter(c => c.id === id).reduce((sum, c) => sum + c.height, 0);
  expect(total(fixed.rows[0].cells[0].id)).toBeCloseTo(72);
  for (const row of fixed.rows) expect(total(row.cells[1].id)).toBeCloseTo(24);
  expect(total(mixed.rows[0].cells[1].id)).toBeCloseTo(16);
  expect(total(mixed.rows[2].cells[1].id)).toBeCloseTo(16);
  // The native reference keeps this E-A-E span short; its final exact row clips the owner.
  expect(total(mixed.rows[1].cells[1].id)).toBeGreaterThan(16);
  expect(total(mixed.rows[1].cells[1].id)).toBeLessThan(24);
  const ownerLines = placed.lines.filter(l => l.cellId === mixed.rows[0].cells[0].id);
  expect(ownerLines.every(l => l.cellClip)).toBe(true);
  const last = ownerLines.at(-1), lastBox = placed.cells.find(c => c.id === last.cellId && c.page === last.page);
  expect(last.y + last.height).toBeGreaterThan(lastBox.y + lastBox.height);
});

it('retains oversized exact rows on one page and shifts repeated-header clips', async () => {
  const doc = model(await DocxPackage.open(source)), placed = layout(doc), table = doc.tables[3], id = table.rows[1].cells[0].id;
  const boxes = placed.cells.filter(c => c.id === id), lines = placed.lines.filter(l => l.cellId === id);
  expect(boxes).toHaveLength(1); expect(boxes[0].height).toBeCloseTo(1200);
  expect(lines).toHaveLength(100); expect(lines.at(-1).page).toBe(boxes.at(-1).page);
  expect(lines.at(-1).y).toBeGreaterThan(lines.at(-1).cellClip.bottom);
  expect([...placed.lines, ...placed.repeatedLines].every(l => l.page < placed.pageCount)).toBe(true);
  for (const line of placed.repeatedLines) {
    const cell = placed.cells.find(c => c.id === line.cellId && c.page === line.page);
    expect(line.cellClip.top).toBeCloseTo(cell.y + 1 / 3); expect(line.cellClip.bottom).toBeCloseTo(cell.y + cell.height - 1 / 3);
  }
  const after = placed.lines.find(l => l.start === doc.text.indexOf('After tall fixed row'));
  const last = boxes.at(-1), remaining = placed.page.height - placed.page.bottom - last.y - last.height;
  if (remaining >= after.height + 1 / 3) { expect(after.page).toBe(last.page); expect(after.y).toBeCloseTo(last.y + last.height + 1 / 3); }
  // This label is inside the next table row: include the header's exterior
  // half-border and the following cell's top half-border.
  else { expect(after.page).toBe(last.page + 1); expect(after.y).toBeCloseTo(placed.page.top + 24 + 2 / 3); }
});

it('retains exact heights across row insertion, merged selection, split, reset and full undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Fixed merged owner');
  expect(doc.selectedTableRows).toHaveLength(3); doc.setTableRowHeight(exact(540));
  expect(doc.selectedTableRows.every(r => rowHeight(r).value === 540)).toBe(true);
  doc.insertTableRow(); expect(doc.tableRowHeight).toEqual(exact(540));
  select(doc, 'Fixed merged owner'); doc.splitCell();
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.tables[1].rows.every(r => rowHeight(r).rule === 'exact')).toBe(true);
  while (doc.history.length) doc.undo(); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  select(doc, 'Exact visible'); doc.setTableRowHeight({ rule: 'auto', value: 0 }); expect(layout(doc).cells[0].height).toBeGreaterThan(42);
  doc.setTableRowHeight(null); expect(doc.tableRowHeight).toEqual(exact(480)); expect(doc.tableContext.row.heightExplicit).toBe(false);
});

it.each([1, 31680])('authors boundary exact value %i without losing overflow or adding phantom pages', async value => {
  const doc = new TextDocument([paragraph()]); doc.insertTable(1, 1); doc.replace('retained\nhidden'); doc.setCellMargins({ top: 0, bottom: 0 }); doc.setTableRowHeight(exact(value));
  const placed = layout(doc), total = placed.cells.reduce((n, c) => n + c.height, 0);
  // The independently authored 1-twip probe preserves the default half-point
  // border floor in the native reference; the stored exact value remains unchanged.
  expect(total).toBeCloseTo(Math.max(value, 10) / 15);
  expect(doc.tableRowHeight).toEqual(exact(value));
  expect(placed.lines.every(l => l.page < placed.pageCount)).toBe(true);
  const at = doc.text.indexOf('hidden'), caret = caretRect(placed, at), line = lineAtPosition(placed, at);
  expect(caret.y).toBeGreaterThanOrEqual(line.cellClip.top); expect(caret.y + caret.height).toBeLessThanOrEqual(line.cellClip.bottom + 1e-6);
  expect(model(await DocxPackage.open(await save(createDocx(), doc))).text).toBe(doc.text);
});

it('retains explicit exact unit spellings until that row is edited', async () => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('w:val="720"', 'w:val="0.5in"'));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg); select(doc, 'Following automatic row'); doc.setTableRowHeight(exact(540));
  const bytes = await save(pkg, doc); expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('w:val="0.5in"');
  sameParts(unzipSync(bytes), parts, ['word/document.xml']);
});

it.each([100, 160, 240])('keeps mixed merged-cell text inside its fragments on a %ipx page', async height => {
  const full = model(await DocxPackage.open(source)), table = full.tables[2];
  const ids = new Set(table.rows.flatMap(r => r.cells.map(c => c.id)));
  const doc = new TextDocument(full.paragraphs.filter(p => ids.has(p.cellId)), full.pageSettings, full.numbering, full.styles, [table], full.assets);
  const page = { ...pageGeometry(doc.pageSettings), height, top: 10, bottom: 10 };
  for (const kept of [false, true]) {
    table.rows[1].cantSplit = kept;
    const placed = layoutDocument(doc.paragraphs, measure, page, doc.numbering, doc.tables);
    for (const line of placed.lines) {
    const cell = placed.cells.find(c => c.id === line.cellId && c.page === line.page);
    expect(cell, `missing fragment for ${line.start}`).toBeDefined();
    if (!line.cellClip) {
      expect(line.y).toBeGreaterThanOrEqual(cell.y - 1e-6); expect(line.y + line.height).toBeLessThanOrEqual(cell.y + cell.height + 1e-6);
    }
    }
    for (const index of [0, 2]) expect(placed.cells.filter(c => c.id === table.rows[index].cells[1].id).reduce((n, c) => n + c.height, 0)).toBeCloseTo(16);
  }
});

it('clips a single line taller than the physical page while retaining its source and caret', () => {
  const doc = new TextDocument([paragraph()]); doc.insertTable(1, 1); doc.replace('.'); doc.selectCell(doc.tables[0].rows[0].cells[0].id); doc.setTableRowHeight(exact(240));
  doc.paragraphs.filter(p => p.cellId).forEach(p => { p.runs.forEach(r => { r.fontSize = 120; }); p.markFormat = { ...p.markFormat, fontSize: 120 }; });
  const page = { width: 816, height: 100, top: 10, bottom: 10, left: 96, right: 96, gap: 24 };
  const placed = layoutDocument(doc.paragraphs, measure, page, doc.numbering, doc.tables), line = placed.lines.find(l => l.cellId);
  expect(line.height).toBeGreaterThan(80); expect(placed.pageCount).toBe(1);
  expect(caretRect(placed, line.start).y + caretRect(placed, line.start).height).toBeLessThanOrEqual(line.cellClip.bottom);
});

it('preserves zero-advance automatic rows without introducing zero-size cell fragments', () => {
  const doc = new TextDocument([paragraph()]); doc.insertTable(1, 1); doc.setCellMargins({ top: 0, bottom: 0 });
  for (const p of doc.paragraphs.filter(p => p.cellId)) p.format = { ...p.format, lineRule: 'auto', lineSpacing: 0, spaceBefore: 0, spaceAfter: 0 };
  expect(layout(doc).cells[0].height).toBeCloseTo(2 / 3);
  doc.setCellBorders(Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style: 'nil', size: 0, color: 'auto' }])));
  const placed = layout(doc); expect(placed.cells).toEqual([]); expect(placed.lines.some(l => l.cellId && l.height === 0)).toBe(true);
});

it('intersects exact paragraph-line clipping and row clipping for caret and selection geometry', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Exact visible');
  const p = doc.paragraphs.find(p => p.cellId === doc.tableContext.cell.id); p.format = { ...p.format, lineRule: 'exact', lineSpacing: 3 };
  const placed = layout(doc), line = lineAtPosition(placed, doc.range[0]), caret = caretRect(placed, doc.range[0]);
  expect(caret.y).toBeGreaterThanOrEqual(line.y); expect(caret.y + caret.height).toBeLessThanOrEqual(Math.min(line.y + line.height, line.cellClip.bottom));
  expect(selectionRects(placed, ...doc.range)[0].height).toBe(4);
});

it('retains the repeated legacy header above a kept oversized exact row', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Tall fixed line 0'); doc.setTableRowKeep(true);
  const placed = layout(doc), id = doc.tableContext.cell.id, boxes = placed.cells.filter(c => c.id === id);
  expect(boxes[0].y).toBeCloseTo(placed.page.top + 24 + 1 / 3); expect(boxes).toHaveLength(1);
  expect(boxes.reduce((n, c) => n + c.height, 0)).toBeCloseTo(1200);
  const headers = placed.cells.filter(c => c.tableId === doc.tableContext.table.id && c.header);
  expect(headers.some(c => !c.repeatedHeader && c.page < boxes[0].page)).toBe(true);
  expect(headers.some(c => c.repeatedHeader && c.page === boxes[0].page)).toBe(true);
});

it('keeps unwrapped floating pictures and their hit targets outside exact rows without enlarging them', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/annual-report.docx')), doc = model(pkg);
  const p = doc.paragraphs.find(p => p.cellId && p.runs.some(r => r.image?.anchor?.horizontal === 'column'));
  expect(p).toBeDefined(); doc.select(doc.paragraphOffset(doc.paragraphs.indexOf(p))); doc.setTableRowHeight(exact(240));
  const placed = layout(doc), frame = placed.floatingObjects.find(f => f.start >= doc.range[0] && f.start <= doc.range[0] + p.runs.map(r => r.text).join('').length);
  expect(frame).toBeDefined(); expect(frame.cellClip).toBeUndefined();
  const cell = placed.cells.find(c => c.id === p.cellId && c.page === frame.page);
  expect(frame.y + frame.height).toBeGreaterThan(cell.y + cell.height);
  expect(imageAtPoint(placed, frame.page, frame.x + 1, cell.y + cell.height + 1)).toBe(frame);
  expect(selectionRects(placed, frame.start, frame.end)).toContainEqual({page:frame.page,x:frame.x,y:frame.y,width:frame.width,height:frame.height});
  const bytes = await save(pkg, doc); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
});
