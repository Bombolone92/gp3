import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { cellSpan, rowGrid, fixedColumnWidths, autoColumnWidths, documentBlocks } from '../src/engine/tables.js';
import { layoutDocument, caretRect, hitTest, selectionRects, verticalLine, lineAtPosition } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/merged-cells.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const spans = table => table.rows.map(row => row.cells.map(cellSpan));
const content = (doc, cell) => doc.paragraphs.filter(p => p.cellId === cell.id).map(paragraphText);
const changed = mutate => {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  mutate(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
};

it('opens independent staggered fixed/AutoFit spans and preserves all original package parts', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), result = layout(doc);
  expect(spans(doc.tables[0])).toEqual([[2, 1], [1, 2], [1, 1, 1], [3]]);
  expect(spans(doc.tables[1])).toEqual([[2, 1], [1, 2], [1, 1, 1]]);
  expect(doc.tables[0].grid).toEqual([1440, 2880, 2880]); expect(doc.tables[1].grid).toEqual([0, 0, 0]);
  expect(result.tableWidths[doc.tables[0].id]).toEqual([96, 192, 192]);
  const header = doc.tables[0].rows[0].cells[0], box = result.cells.find(c => c.id === header.id);
  expect(box.width).toBe(288); expect(box.fill).toBe('#EAF2FC');
  expect(doc.paragraphs.find(p => p.cellId === header.id).runs[0]).toMatchObject({ italic: true, bold: true });
  const exported = unzipSync(await save(pkg, doc)), original = unzipSync(source);
  for (const name of Object.keys(original)) expect(Buffer.from(exported[name]).equals(Buffer.from(original[name])), name).toBe(true);
});

it('uses combined grid widths, grows the final spanned column for later fixed requests, and handles overlapping AutoFit constraints', () => {
  const table = { grid: [1000, 2000, 3000], width: { type: 'auto', value: 0 }, rows: [{ cells: [{ span: 2, width: { type: 'dxa', value: 3000 } }, { width: { type: 'dxa', value: 3000 } }] }, { cells: [{ width: { type: 'dxa', value: 1500 } }, { span: 2, width: { type: 'dxa', value: 6000 } }] }] };
  expect(fixedColumnWidths(table, 9000)).toEqual([1500, 2000, 4000]);
  const auto = { grid: [0, 0, 0], width: { type: 'auto', value: 0 }, rows: [{ cells: [{ span: 2 }, {}] }, { cells: [{}, { span: 2 }] }] };
  const metrics = [0, 1, 2].map(() => ({ min: 100, floor: 100, max: 100 }));
  const constraints = [{ column: 0, span: 2, min: 2000, max: 2000, floor: 200 }, { column: 1, span: 2, min: 2000, max: 2000, floor: 200 }];
  const widths = autoColumnWidths(auto, 2100, metrics, 2100, constraints);
  expect(widths.reduce((a,b) => a+b, 0)).toBe(2100); expect(widths[0] + widths[1]).toBeGreaterThanOrEqual(2000); expect(widths[1] + widths[2]).toBeGreaterThanOrEqual(2000);
  expect(autoColumnWidths(auto, 300, metrics, 300, constraints)).toEqual([100, 100, 100]);
  const single = { grid: [0, 0, 0], width: { type: 'auto', value: 0 }, rows: [{ cells: [{ span: 3 }] }] };
  expect(autoColumnWidths(single, 3000, metrics.map(() => ({ min: 0, max: 0, floor: 0 })), 3000, [{ column: 0, span: 3, min: 2100, max: 2100, floor: 300 }])).toEqual([700, 700, 700]);
});

it('edits merged text, flows across pages, navigates between different spans and restores caret/selection geometry', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0], original = layout(doc);
  expect(original.cells.filter(c => c.id === table.rows[1].cells[1].id).length).toBeGreaterThan(1);
  for (const row of table.rows) for (const cell of row.cells) {
    doc.selectCell(cell.id); const at = doc.selection.focus, caret = caretRect(original, at);
    expect(hitTest(original, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at);
  }
  doc.selectCell(table.rows[0].cells[1].id); const line = lineAtPosition(original, doc.selection.focus);
  expect(verticalLine(original, line, 1, line.stops[0].x).cellId).toBe(table.rows[1].cells[1].id);
  doc.selectCell(table.rows[0].cells[0].id);
  expect(verticalLine(original, lineAtPosition(original, doc.selection.focus), 1, 130).cellId).toBe(table.rows[1].cells[0].id);
  doc.selectCell(table.rows[1].cells[1].id); const at = doc.selection.focus; doc.replace('Á😀 revised ');
  doc.select(at, at + 13); doc.setRunFormat({ fontSize: 20 });
  const result = layout(doc); expect(selectionRects(result, ...doc.range).length).toBeGreaterThan(0);
  expect(verticalLine(result, lineAtPosition(result, doc.text.indexOf('Side')), 1, 400).cellId).toBe(table.rows[1].cells[1].id);
  for (const cell of result.cells) expect(cell.y + cell.height).toBeLessThanOrEqual(result.page.height - result.page.bottom + 1e-6);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.text).toBe(doc.text); expect(spans(reopened.tables[0])).toEqual(spans(table));
  doc.undo(); doc.undo(); expect(layout(doc)).toEqual(original);
});

it('merges complete cell contents and splits along existing grid lines with reversible selection and formatting', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0], row = table.rows[2];
  const from = doc.text.indexOf('Left') + 2, to = doc.text.indexOf('Right') + 2;
  doc.select(to, from); const before = doc.snapshot(), text = doc.text;
  doc.mergeCells(); expect(row.cells).toHaveLength(1); expect(cellSpan(row.cells[0])).toBe(3); expect(doc.text).toBe(text);
  expect(content(doc, row.cells[0])).toEqual(['Left', 'Middle', 'Right']); expect(doc.selection).toEqual(before.selection);
  const merged = doc.snapshot(); doc.splitCell(); expect(row.cells.map(cellSpan)).toEqual([1, 1, 1]);
  expect(content(doc, row.cells[0])).toEqual(['Left', 'Middle', 'Right']); expect(content(doc, row.cells[1])).toEqual(['']);
  expect(row.cells.map(c => c.width.value)).toEqual([1440, 2880, 2880]);
  const exported = await DocxPackage.open(await save(pkg, doc)); expect(spans(exported.tables[0])[2]).toEqual([1, 1, 1]);
  expect(model(exported).text).toBe(doc.text);
  expectBodyEditParts(exported.parts, pkg.parts);
  doc.undo(); expect(doc.snapshot()).toEqual(merged); doc.undo(); expect(doc.snapshot()).toEqual(before);
  const undone = unzipSync(await save(pkg, doc)); for (const name of Object.keys(pkg.parts)) expect(Buffer.from(undone[name]).equals(Buffer.from(pkg.parts[name])), name).toBe(true);
});

it('merges empty cells and rejects selections across rows or outside tables without changing history', () => {
  const doc = model(createDocx([paragraph()])); doc.insertTable(2, 3);
  let table = doc.tables[0]; doc.selectCell(table.rows[0].cells[0].id); const from = doc.selection.focus;
  doc.selectCell(table.rows[0].cells[2].id); doc.select(from, doc.selection.focus); doc.mergeCells();
  expect(cellSpan(table.rows[0].cells[0])).toBe(3); expect(content(doc, table.rows[0].cells[0])).toEqual(['', '', '']);
  doc.selectCell(table.rows[1].cells[0].id); doc.select(from, doc.selection.focus); const snapshot = doc.snapshot(), length = doc.history.length;
  expect(() => doc.mergeCells()).toThrow(/one row/); expect(doc.snapshot()).toEqual(snapshot); expect(doc.history).toHaveLength(length);
  doc.select(0, from); expect(doc.mergeCellsContext).toBe(null);
});

it('inserts and deletes grid columns through staggered spans, retains partially overlapped content and copies spans into new rows', async () => {
  for (const auto of [false, true]) {
    const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[auto ? 1 : 0];
    doc.selectCell(table.rows[1].cells[0].id); const before = doc.snapshot(); doc.insertTableColumn();
    expect(spans(table).slice(0, 2)).toEqual([[3, 1], [1, 1, 2]]); expect(table.grid).toHaveLength(4);
    doc.replace('Inserted'); doc.deleteTablePart('column'); expect(doc.text).not.toContain('Inserted'); expect(spans(table).slice(0, 2)).toEqual([[2, 1], [1, 2]]);
    expect(content(doc, table.rows[0].cells[0])[0]).toBe(auto ? 'Extraordinarylongword' : 'Wide heading');
    doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
    const active = doc.tables[auto ? 1 : 0]; doc.selectCell(active.rows[0].cells[0].id); doc.insertTableRow();
    expect(spans(active)[1]).toEqual([2, 1]); expect(content(doc, active.rows[1].cells[0])).toEqual(['']);
    doc.deleteTablePart('column'); expect(active.grid).toHaveLength(1);
    expect(content(doc, active.rows[2].cells[0])[0]).toMatch(auto ? /Otherlongword/ : /Long merged cell/);
    const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.text).toBe(doc.text); layout(reopened); documentBlocks(doc.paragraphs, doc.tables);
  }
});

it('updates spanned cell preferences from grid widths and augments an underspecified source grid without rewriting it for text edits', async () => {
  const input = changed(xml => xml.getElementsByTagNameNS(W, 'tblGrid')[0].lastElementChild.remove());
  const pkg = await DocxPackage.open(input), doc = model(pkg), table = doc.tables[0];
  expect(table.grid).toEqual([1440, 2880, 1440]); doc.selectCell(table.rows[0].cells[0].id); doc.replace('Added ');
  const first = await DocxPackage.open(await save(pkg, doc));
  expect(new DOMParser().parseFromString(strFromU8(first.parts['word/document.xml']), 'application/xml').getElementsByTagNameNS(W, 'tblGrid')[0].children).toHaveLength(2);
  doc.setTableProperties({ columns: [1800, 1800, 3600] });
  expect(table.rows[0].cells.map(c => c.width.value)).toEqual([3600, 3600]); expect(table.rows[1].cells.map(c => c.width.value)).toEqual([1800, 5400]);
  const before = doc.snapshot(); expect(() => doc.setTableProperties({ columns: [31680, 31680, 31680] })).toThrow(/22 inches/); expect(doc.snapshot()).toEqual(before);
  const exported = await DocxPackage.open(await save(pkg, doc)), out = model(exported); expect(out.tables[0].grid).toEqual([1800, 1800, 3600]); layout(out);
  const tcPr = new DOMParser().parseFromString(strFromU8(exported.parts['word/document.xml']), 'application/xml').getElementsByTagNameNS(W, 'tcPr')[0];
  expect([...tcPr.children].map(n => n.localName).slice(0, 3)).toEqual(['cnfStyle', 'tcW', 'gridSpan']);
});

it('rejects invalid spans, omitted cells and legacy merges before editable open', async () => {
  for (const [name, mutate] of [
    ['zero', xml => xml.getElementsByTagNameNS(W, 'gridSpan')[0].setAttributeNS(W, 'w:val', '0')],
    ['missing value', xml => xml.getElementsByTagNameNS(W, 'gridSpan')[0].removeAttributeNS(W, 'val')],
    ['overflow', xml => xml.getElementsByTagNameNS(W, 'gridSpan')[0].setAttributeNS(W, 'w:val', '33')],
    ['omitted', xml => xml.getElementsByTagNameNS(W, 'tr')[0].lastElementChild.remove()],
    ['legacy', xml => xml.getElementsByTagNameNS(W, 'tcPr')[0].append(xml.createElementNS(W, 'w:hMerge'))],
  ]) {
    let error; try { await DocxPackage.open(changed(mutate)); } catch (e) { error = e; }
    expect(error?.name, name).toBe('UnsupportedDocumentError');
  }
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
  const style = [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === 'TableGrid');
  const pr = xml.createElementNS(W, 'w:tcPr'), span = xml.createElementNS(W, 'w:gridSpan'); span.setAttributeNS(W, 'w:val', '2'); pr.append(span); style.append(pr);
  parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/grid spans declared by table styles/);
});

it('reflows AutoFit merged text and shared font changes without overwriting the grid and restores geometry on undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[1], original = layout(doc);
  doc.selectCell(table.rows[0].cells[0].id); const at = doc.selection.focus;
  doc.replace('W'.repeat(120)); const changed = layout(doc);
  // Legacy AutoFit includes the exterior cell margins in its page-width cap,
  // as independently captured by the table-unbreakable reference controls.
  expect(changed.tableWidths[table.id].reduce((a,b) => a+b, 0)).toBeCloseTo(494.4);
  expect(changed.lines.filter(l => l.cellId === table.rows[0].cells[0].id).length).toBeGreaterThan(1);
  expect(table.grid).toEqual([0, 0, 0]); const caret = caretRect(changed, at + 80);
  expect(hitTest(changed, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 80);
  doc.undo(); expect(layout(doc)).toEqual(original);
  doc.editParagraphStyle('Normal', { run: { fontSize: 16 } }); const styled = layout(doc);
  expect(styled.tableWidths[table.id].reduce((a,b) => a+b, 0)).toBeGreaterThan(original.tableWidths[table.id].reduce((a,b) => a+b, 0));
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(layout(reopened).tableWidths[reopened.tables[1].id]).toEqual(styled.tableWidths[table.id]);
});
