import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects, imageAtPoint } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { rowHeight } from '../src/engine/row-height.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/row-heights.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const settings = (rule, value = 0) => ({ rule, value });
function sameParts(a, b, except = []) { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key of Object.keys(a)) if (!except.includes(key)) expect(Buffer.from(a[key]).equals(Buffer.from(b[key])), key).toBe(true); }
const rewrite = (from, to, path = 'word/document.xml') => { const parts = unzipSync(source); expect(strFromU8(parts[path])).toContain(from); parts[path] = strToU8(strFromU8(parts[path]).replace(from, to)); return zipSync(parts); };

it('resolves style heights, explicit auto/zero, Word’s omitted rule and standard missing values and units', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), rows = doc.tables[0].rows;
  expect(rows.map(rowHeight)).toEqual([settings('atLeast', 960), settings('auto'), settings('atLeast', 1440), settings('atLeast', 240), settings('atLeast'), settings('atLeast', 1440), settings('atLeast')]);
  expect(rows.map(r => r.heightExplicit)).toEqual([false, true, true, true, true, true, true]);
  expect(rows.every(r => r.inheritedRowHeight.rule === 'atLeast' && r.inheritedRowHeight.value === 960)).toBe(true);
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits minimum heights and inheritance atomically, preserving declarations, selection and full undo bytes', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Inherited minimum'); const before = doc.snapshot();
  doc.setTableRowHeight(settings('atLeast', 1440)); select(doc, 'Direct automatic'); doc.setTableRowHeight(null); select(doc, 'Omitted rule'); doc.setTableRowHeight(settings('auto'));
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.tables[0].rows.slice(0, 3).map(rowHeight)).toEqual([settings('atLeast', 1440), settings('atLeast', 960), settings('auto')]);
  expect(reopened.tables[0].rows[1].heightExplicit).toBe(false); expect(reopened.text).toBe(doc.text); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(doc.tableRowHeight).toEqual(settings('auto'));
});

it('preserves no-ops and redo history, while explicit values can override an equal inherited minimum', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Inherited minimum'); expect(doc.setTableRowHeight(null)).toBe(false);
  expect(doc.setTableRowHeight(settings('atLeast', 960))).toBe(true); expect(doc.tableContext.row.heightExplicit).toBe(true);
  doc.setTableRowHeight(settings('auto')); doc.undo(); const state = doc.snapshot(); expect(doc.setTableRowHeight(settings('atLeast', 960))).toBe(false); expect(doc.future).toHaveLength(1); expect(doc.snapshot()).toEqual(state);
  doc.redo(); expect(doc.tableRowHeight).toEqual(settings('auto'));
});

it('grows rows past small minimums and moves vertically aligned text, caret, selection and following rows', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Inherited minimum'); const before = layout(doc), id = doc.tableContext.cell.id;
  const box = l => l.cells.find(c => c.id === id), line = l => l.lines.find(c => c.cellId === id), oldCaret = caretRect(before, doc.range[0]);
  expect(box(before).height).toBeCloseTo(64 + 2 / 3);
  doc.setTableRowHeight(settings('atLeast', 1920)); const after = layout(doc), caret = caretRect(after, doc.range[0]);
  expect(box(after).height).toBeCloseTo(128 + 2 / 3); expect(line(after).y - line(before).y).toBeCloseTo(32); expect(caret.y - oldCaret.y).toBeCloseTo(32);
  expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(doc.range[0]); expect(selectionRects(after, ...doc.range)[0].y).toBe(caret.y);
  expect(line(after).fragments).toEqual(line(before).fragments); expect(after.tableWidths).toEqual(before.tableWidths);
  doc.undo(); expect(layout(doc)).toEqual(before);
  select(doc, 'Content grows'); const cellId = doc.tableContext.cell.id, result = layout(doc); expect(result.cells.find(c => c.id === cellId).height).toBeGreaterThan(240 / 15);
});

it('edits all rows covered by vertical merges and retains height through row insertion, split and deletion', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Merged owner'); expect(doc.selectedTableRows).toHaveLength(3); expect(doc.tableRowHeight).toBeNull();
  doc.setTableRowHeight(settings('atLeast', 960)); expect(doc.selectedTableRows.every(r => r.minHeight === 960)).toBe(true);
  doc.insertTableRow(); expect(doc.tableContext.row.minHeight).toBe(960); expect(doc.tableContext.row.heightExplicit).toBe(true);
  select(doc, 'Merged owner'); doc.splitCell(); expect(doc.tables[1].rows.every(r => r.minHeight === 960)).toBe(true); doc.deleteTablePart('row');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.tables[1].rows).toHaveLength(3); expect(reopened.tables[1].rows.every(r => r.minHeight === 960)).toBe(true); expect(() => layout(reopened)).not.toThrow();
});

it('applies mixed selections across tables and leaves a final paragraph-start boundary unselected', async () => {
  const doc = model(await DocxPackage.open(source)); const start = doc.text.indexOf('Zero minimum'), end = doc.text.indexOf('Before repeated rows'); doc.select(start, end);
  expect(doc.tableRowHeight).toBeNull(); const rows = doc.selectedTableRows; expect(rows.length).toBeGreaterThan(3); doc.setTableRowHeight(settings('atLeast', 720)); expect(rows.every(r => r.minHeight === 720)).toBe(true);
  expect(doc.tables[2].rows[0].minHeight).toBe(720); // unchanged original 36 pt header
  expect(doc.tables[2].rows[1].minHeight).toBe(18000);
  doc.undo(); expect(doc.range).toEqual([start, end]);
});

it('reflows tall minimum rows and repeated headers across pages without duplicating text or losing hit targets', async () => {
  const doc = model(await DocxPackage.open(source)), original = doc.text; select(doc, 'Tall minimum'); const before = layout(doc), id = doc.tableContext.cell.id;
  expect(before.cells.filter(c => c.id === id)).toHaveLength(1); doc.setTableRowHeight(settings('auto')); const after = layout(doc); expect(after.pageCount).toBeLessThan(before.pageCount); expect(doc.text).toBe(original); doc.undo(); expect(layout(doc)).toEqual(before);
  select(doc, 'Header height'); doc.setTableRowHeight(settings('atLeast', 840)); const result = layout(doc), header = doc.tableContext.cell.id;
  const boxes = result.cells.filter(c => c.id === header); expect(boxes.length).toBeGreaterThan(1); for (const box of boxes) expect(box.height).toBeCloseTo(56 + 2 / 3);
  expect(result.repeatedLines.some(l => l.cellId === header)).toBe(true);
  const line = result.repeatedLines.find(l => l.cellId === header); expect(hitTest(result, line.page, line.stops[0].x, line.y + line.height / 2)).toBe(line.start);
});

it('keeps inline images and their hit targets with bottom-aligned cell content after row growth', async () => {
  const doc = model(await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx'))), index = doc.paragraphs.findIndex(p => p.cellId && p.runs.some(r => r.image));
  doc.select(doc.paragraphOffset(index)); doc.setCellVerticalAlignment('bottom'); const before = layout(doc); doc.setTableRowHeight(settings('atLeast', 2880)); const after = layout(doc), p = doc.paragraphs[index];
  const old = before.lines.find(l => l.paragraphId === p.id && l.fragments.some(f => f.image)), line = after.lines.find(l => l.paragraphId === p.id && l.fragments.some(f => f.image)), image = line.fragments.find(f => f.image);
  expect(line.page * after.page.height + line.baseline).toBeGreaterThan(old.page * before.page.height + old.baseline); expect(imageAtPoint(after, line.page, image.x + image.width / 2, line.baseline - image.ascent / 2)).toBe(image); doc.undo(); expect(layout(doc)).toEqual(before);
});

it('authors new-table heights and retains copied heights through save and reopen', async () => {
  const doc = new TextDocument([paragraph()]); doc.insertTable(2, 2); doc.replace('First'); doc.setTableRowHeight(settings('atLeast', 1200)); doc.insertTableRow(); doc.replace('Copied');
  doc.setTableRowHeight(settings('auto')); const pkg = createDocx(); const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables[0].rows.map(rowHeight)).toEqual([settings('atLeast', 1200), settings('auto'), settings('auto')]); expect(reopened.text).toBe(doc.text);
});

it.each([['1440', 1440], ['+01440', 1440], ['1in', 1440], ['2.54cm', 1440], ['25.4mm', 1440], ['72pt', 1440], ['6pc', 1440], ['6pi', 1440], ['1mm', 57]])('reads supported row-height measurement %s', async (raw, value) => {
  const doc = model(await DocxPackage.open(rewrite('<w:trHeight w:val="1440"/>', `<w:trHeight w:val="${raw}"/>`))); expect(doc.tables[0].rows[2].minHeight).toBe(value);
});
it.each(['w:val="-1"', 'w:val="1.5"', 'w:val="bad"', 'w:val=""', 'w:val="31681"', 'w:val="18446744073709551616"', 'w:hRule=""', 'w:hRule="minimum"', 'w:hRule="exact" w:val="0"', 'w:val="1" w:other="1"'])('rejects invalid or unsupported height declarations: %s', async attrs => {
  await expect(DocxPackage.open(rewrite('<w:trHeight w:val="1440"/>', `<w:trHeight ${attrs}/>`))).rejects.toThrow(/height/);
});
it.each(['<w:trHeight/><w:trHeight/>', '<w:trHeight><w:val/></w:trHeight>', '<w:trHeight>text</w:trHeight>'])('rejects duplicate or nested height content: %s', async content => {
  await expect(DocxPackage.open(rewrite('<w:trHeight w:val="1440"/>', content))).rejects.toThrow(/height|trHeight/i);
});
it('preserves valid ignored automatic values and source spellings after an unrelated row edit', async () => {
  const pkg = await DocxPackage.open(rewrite('w:val="7200" w:hRule="auto"', 'w:val="18446744073709551615" w:hRule="auto"')), doc = model(pkg);
  select(doc, 'Omitted rule'); doc.setTableRowHeight(settings('atLeast', 1441)); const exported = await save(pkg, doc), xml = strFromU8(unzipSync(exported)['word/document.xml']);
  expect(xml).toContain('w:val="18446744073709551615" w:hRule="auto"'); expect(xml).toContain('w:val="1in"'); expect(model(await DocxPackage.open(exported)).tables[0].rows[1].minHeight).toBe(0);
});
it.each([{}, { rule: 'exact', value: 0 }, settings('auto', 1), settings('atLeast', -1), settings('atLeast', .5), settings('atLeast', 31681), settings('atLeast', NaN)])('rejects invalid editing atomically: %j', value => {
  const doc = new TextDocument([paragraph()]); doc.insertTable(1, 1); const before = doc.snapshot(), history = doc.history.length;
  expect(() => doc.setTableRowHeight(value)).toThrow(); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(history);
});
