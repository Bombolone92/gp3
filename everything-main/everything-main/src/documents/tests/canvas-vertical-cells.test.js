import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { verticalMerges, editableCells, documentBlocks, cellSpan } from '../src/engine/tables.js';
import { layoutDocument, caretRect, hitTest, selectionRects, verticalLine, lineAtPosition } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/vertical-cells.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const content = (doc, cell) => doc.paragraphs.filter(p => p.cellId === cell.id).map(paragraphText);
const changed = mutate => {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  mutate(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
};

it('opens independent vertical and rectangular merges with one editable owner and preserves every source entry', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0], owners = verticalMerges(table);
  expect(owners.get(table.rows[1].cells[0].id)).toMatchObject({ rowIndex: 0, endRow: 1, column: 0, span: 1 });
  expect(owners.get(table.rows[3].cells[1].id)).toMatchObject({ rowIndex: 2, endRow: 3, column: 1, span: 2 });
  expect(content(doc, table.rows[1].cells[0])).toEqual([]);
  expect(content(doc, table.rows[0].cells[0])).toEqual(['Top', '', 'Second Á😀']);
  expect(doc.paragraphs.find(p => p.cellId === table.rows[0].cells[0].id).runs[0]).toMatchObject({ italic: true, bold: true });
  const orphan = doc.tables[1].rows[2].cells[2]; expect(content(doc, orphan)).toEqual(['Z']);
  const exported = unzipSync(await save(pkg, doc));
  for (const [name, bytes] of Object.entries(unzipSync(source))) expect(Buffer.from(exported[name]).equals(Buffer.from(bytes)), name).toBe(true);
});

it('lays out merged groups with shared borders, source-offset caret navigation and no continuation stops', async () => {
  const doc = model(await DocxPackage.open(source)), table = doc.tables[0], result = layout(doc);
  expect(result.pageCount).toBeGreaterThan(1);
  for (const owner of new Set(verticalMerges(table).values())) {
    const box = result.cells.find(c => c.id === owner.cell.id); expect(box).toBeDefined();
    if (owner.cells.length > 1) {
      expect(result.cells.filter(c => owner.cells.slice(1).some(p => p.id === c.id))).toHaveLength(0);
      const last = result.cells.filter(c => c.id === owner.cell.id).at(-1);
      const neighbor = result.cells.filter(c => c.id === table.rows[owner.endRow].cells.find(c => !owner.cells.includes(c))?.id).at(-1);
      expect(last.page).toBe(neighbor.page); expect(last.y + last.height).toBeCloseTo(neighbor.y + neighbor.height);
    }
    doc.selectCell(owner.cell.id); const at = doc.selection.focus, caret = caretRect(result, at);
    expect(hitTest(result, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at);
  }
  doc.selectCell(table.rows[0].cells[0].id); doc.moveCell(1); expect(doc.tableContext.cell.id).toBe(table.rows[0].cells[1].id);
  doc.moveCell(1); doc.moveCell(1); expect(doc.tableContext.cell.id).toBe(table.rows[1].cells[1].id);
  const last = result.lines.filter(l => l.cellId === table.rows[0].cells[0].id).at(-1);
  expect(verticalLine(result, last, 1, last.stops[0].x).cellId).toBe(table.rows[2].cells[0].id);
  const upper = lineAtPosition(result, doc.text.indexOf('D0'));
  expect(verticalLine(result, upper, -1, upper.stops[0].x).cellId).toBe(table.rows[0].cells[0].id);
  const anchor = result.cells.find(c => c.id === table.rows[0].cells[0].id);
  const position = hitTest(result, anchor.page, anchor.x + 10, anchor.y + anchor.height - 3);
  expect(lineAtPosition(result, position).cellId).toBe(anchor.id);
  for (const rect of selectionRects(result, 0, doc.text.length)) expect(rect.y + rect.height).toBeLessThanOrEqual(result.page.height - result.page.bottom + 1e-6);
  doc.selectCell(table.rows[0].cells[0].id); expect(doc.selectedTableRows).toEqual(table.rows.slice(0, 2));
  doc.setTableRowKeep(true); expect(table.rows.slice(0, 2).every(r => r.cantSplit)).toBe(true); doc.undo();
});

it('merges below including an existing group, retains all paragraphs and selection identity, and restores exact bytes on undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0];
  doc.selectCell(table.rows[4].cells[0].id); const before = doc.snapshot(), originalLayout = layout(doc);
  doc.mergeCellBelow(); expect(content(doc, table.rows[4].cells[0])).toEqual(['F0', 'G0']);
  expect(content(doc, table.rows[5].cells[0])).toEqual([]); expect(doc.selection).toEqual(before.selection);
  expect(doc.text.indexOf('G0')).toBeLessThan(doc.text.indexOf('F1'));
  const merged = doc.snapshot(); doc.splitCell(); expect(content(doc, table.rows[5].cells[0])).toEqual(['']);
  expect(content(doc, table.rows[4].cells[0])).toEqual(['F0', 'G0']); doc.undo(); expect(doc.snapshot()).toEqual(merged);
  doc.undo(); expect(doc.snapshot()).toEqual(before); expect(layout(doc)).toEqual(originalLayout);
  const exported = unzipSync(await save(pkg, doc)); for (const [name, bytes] of Object.entries(pkg.parts)) expect(Buffer.from(exported[name]).equals(Buffer.from(bytes)), name).toBe(true);
  // Extend upward into a group without flattening or duplicating its content.
  doc.selectCell(table.rows[1].cells[1].id); expect(doc.mergeBelowContext).toBeNull();
  const fresh = model(createDocx([paragraph()])); fresh.insertTable(3, 2);
  const t = fresh.tables[0]; for (let r = 0; r < 3; r++) { fresh.selectCell(t.rows[r].cells[0].id); fresh.replace(String(r)); }
  fresh.selectCell(t.rows[1].cells[0].id); fresh.mergeCellBelow(); fresh.selectCell(t.rows[0].cells[0].id); fresh.mergeCellBelow();
  expect(content(fresh, t.rows[0].cells[0])).toEqual(['0', '1', '2']); expect(editableCells(t)).toHaveLength(4); layout(fresh);
});

it('splits rectangular merges into grid cells, retains formatting and rejects horizontal merges across a vertical boundary', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0];
  doc.select(doc.text.indexOf('Top'), doc.text.indexOf('B0') + 2); expect(doc.mergeCellsContext).toBeNull();
  doc.selectCell(table.rows[2].cells[1].id); const before = doc.snapshot(); doc.splitCell();
  expect(table.rows.slice(2, 4).map(r => r.cells.map(cellSpan))).toEqual([[1, 1, 1], [1, 1, 1]]);
  expect(content(doc, table.rows[2].cells[1])).toEqual(['Wide', '', '', '']);
  for (const cell of [table.rows[2].cells[2], ...table.rows[3].cells.slice(1)]) expect(content(doc, cell)).toEqual(['']);
  const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text); layout(out);
  doc.undo(); expect(doc.snapshot()).toEqual(before);
  const gap = model(createDocx([paragraph()])); gap.insertTable(2, 3);
  const t = gap.tables[0]; gap.selectCell(t.rows[0].cells[1].id); gap.mergeCellBelow();
  gap.selectCell(t.rows[1].cells[0].id); const from = gap.selection.focus; gap.selectCell(t.rows[1].cells[2].id); gap.select(from, gap.selection.focus);
  const snapshot = gap.snapshot(); expect(gap.mergeCellsContext).toBeNull(); expect(() => gap.mergeCells()).toThrow(); expect(gap.snapshot()).toEqual(snapshot);
});

it('extends merges when inserting inside them and inserts below the full active merged cell', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0];
  doc.selectCell(table.rows[0].cells[1].id); const before = doc.snapshot(); doc.insertTableRow();
  expect(verticalMerges(table).get(table.rows[0].cells[0].id).endRow).toBe(2);
  expect(content(doc, table.rows[1].cells[0])).toEqual([]); expect(doc.tableContext.cell.id).toBe(table.rows[1].cells[1].id);
  doc.replace('Inserted'); const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text); layout(out);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
  doc.selectCell(doc.tables[0].rows[0].cells[0].id); doc.insertTableRow();
  expect(verticalMerges(doc.tables[0]).get(doc.tables[0].rows[0].cells[0].id).endRow).toBe(1);
  expect(doc.tableContext.rowIndex).toBe(2); expect(content(doc, doc.tableContext.cell)).toEqual(['']);
});

it('promotes merged content and appearance when deleting its top row and preserves it when deleting a continuation row', async () => {
  for (const rowIndex of [0, 1]) {
    const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0];
    doc.selectCell(table.rows[rowIndex].cells[rowIndex ? 1 : 0].id); const before = doc.snapshot(); doc.deleteTablePart('row');
    expect(content(doc, table.rows[0].cells[0])).toEqual(['Top', '', 'Second Á😀']); expect(table.rows[0].cells[0].fill).toBe('#EAF2FC');
    expect(doc.text).not.toContain(rowIndex ? 'B1' : 'B0');
    const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text); layout(out);
    doc.undo(); expect(doc.snapshot()).toEqual(before);
  }
});

it('keeps vertical spans aligned through fixed and AutoFit column insertion, deletion and save/reopen', async () => {
  for (const tableIndex of [0, 1]) {
    const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[tableIndex];
    doc.selectCell(table.rows[2].cells[0].id); const before = doc.snapshot(); doc.insertTableColumn();
    const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text); layout(out);
    doc.replace('New column'); doc.deleteTablePart('column'); expect(doc.text).not.toContain('New column');
    expect(verticalMerges(table).get(table.rows[0].cells[0].id).endRow).toBe(1); documentBlocks(doc.paragraphs, doc.tables); layout(doc);
    doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
    // A one-column deletion through a two-column vertical merge shrinks every physical continuation.
    const t = doc.tables[tableIndex]; doc.selectCell(t.rows[tableIndex ? 2 : 4].cells[1].id); doc.deleteTablePart('column');
    const merged = t.rows[tableIndex ? 0 : 2].cells[tableIndex ? 0 : 1]; expect(cellSpan(merged)).toBe(1);
    expect(verticalMerges(t).get(merged.id).cells.map(cellSpan)).toEqual([1, 1]);
    expect(model(await DocxPackage.open(await save(pkg, doc))).text).toBe(doc.text); layout(doc);
  }
});

it('reflows inherited styles and text while retaining source continuations and unrelated package parts', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), table = doc.tables[0];
  doc.selectCell(table.rows[0].cells[0].id); const before = doc.snapshot(); doc.replace('Edited ');
  doc.editParagraphStyle('Normal', { run: { fontSize: 12 } }); const result = layout(doc);
  const exported = await DocxPackage.open(await save(pkg, doc)), out = model(exported); expect(out.text).toBe(doc.text);
  expect(layout(out).pageCount).toBe(result.pageCount);
  const xml = new DOMParser().parseFromString(strFromU8(exported.parts['word/document.xml']), 'application/xml');
  const tc = xml.getElementsByTagNameNS(W, 'tr')[1].getElementsByTagNameNS(W, 'tc')[0];
  expect(tc.getElementsByTagNameNS(W, 'spacing')[0].getAttributeNS(W, 'after')).toBe('123');
  expectBodyEditParts(exported.parts, pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
});

it('rejects mismatched grids, invalid merge values and nonempty continuations, while flowing large groups', async () => {
  for (const mutate of [
    xml => xml.getElementsByTagNameNS(W, 'vMerge')[0].setAttributeNS(W, 'w:val', ''),
    xml => { const row = xml.getElementsByTagNameNS(W, 'tr')[1], tc = row.getElementsByTagNameNS(W, 'tc')[0], span = xml.createElementNS(W, 'w:gridSpan'); span.setAttributeNS(W, 'w:val', '2'); tc.firstElementChild.prepend(span); row.getElementsByTagNameNS(W, 'tc')[1].remove(); },
    xml => { const tc = xml.getElementsByTagNameNS(W, 'tr')[1].getElementsByTagNameNS(W, 'tc')[0], run = xml.createElementNS(W, 'w:r'), text = xml.createElementNS(W, 'w:t'); text.textContent = 'Hidden text'; run.append(text); tc.lastElementChild.append(run); },
  ]) await expect(DocxPackage.open(changed(mutate))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const doc = model(await DocxPackage.open(source)); doc.selectCell(doc.tables[0].rows[0].cells[0].id); doc.replace('Overflow '.repeat(250));
  expect(layout(doc).pageCount).toBeGreaterThan(2); doc.undo(); expect(() => layout(doc)).not.toThrow();
  const parts = unzipSync(source), styles = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
  const style = [...styles.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === 'CanvasVerticalTable');
  const pr = styles.createElementNS(W, 'w:tcPr'), merge = styles.createElementNS(W, 'w:vMerge'); merge.setAttributeNS(W, 'w:val', 'restart'); pr.append(merge); style.append(pr);
  parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(styles));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/vertical merges declared by table styles/);
});

it('ignores orphan continuation chains and appends a usable row after a fully merged table', async () => {
  const orphaned = changed(xml => xml.getElementsByTagNameNS(W, 'vMerge')[0].remove());
  const imported = model(await DocxPackage.open(orphaned)); expect(editableCells(imported.tables[0])).toHaveLength(15);
  expect(content(imported, imported.tables[0].rows[1].cells[0])).toEqual(['']); layout(imported);
  const pkg = createDocx([paragraph()]), doc = model(pkg); doc.insertTable(2, 2);
  for (const row of doc.tables[0].rows) { doc.selectCell(row.cells[0].id); const at = doc.selection.focus; doc.selectCell(row.cells[1].id); doc.select(at, doc.selection.focus); doc.mergeCells(); }
  doc.selectCell(doc.tables[0].rows[0].cells[0].id); doc.mergeCellBelow(); doc.replace('Full width');
  doc.moveCell(1); expect(doc.tableContext.rowIndex).toBe(2); expect(doc.tableContext.span).toBe(2); doc.replace('New row');
  const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.text).toBe(doc.text); layout(out);
});
