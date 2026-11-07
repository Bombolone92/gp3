import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { cellContext, tableCells } from '../src/engine/tables.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/cell-alignment.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const paragraph = (doc, text) => doc.paragraphs.find(p => paragraphText(p) === text);
const cell = (doc, text) => cellContext(doc.tables, paragraph(doc, text).cellId).cell;
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
function sameParts(actual, expected, except = []) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
const rewrite = (from, to, path = 'word/document.xml') => {
  const parts = unzipSync(source); expect(strFromU8(parts[path])).toContain(from);
  parts[path] = strToU8(strFromU8(parts[path]).replace(from, to)); return zipSync(parts);
};

it('resolves table-style chains, direct top resets, merged owners and no-edit preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [label, vertical, inheritedVertical, verticalExplicit] of [
    ['Inherited center', 'center', 'center', false], ['Direct top', 'top', 'center', true], ['Direct bottom', 'bottom', 'center', true],
    ['Vertical center', 'center', 'bottom', true], ['Inherited bottom', 'bottom', 'bottom', false], ['Header center', 'center', 'center', false],
    ['Height reference\vSecond line', 'top', 'center', true],
  ]) expect(cell(doc, label)).toMatchObject({ vertical, inheritedVertical, verticalExplicit });
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('aligns inside unequal cell margins while preserving paragraph spacing, row heights and wrapping', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc);
  const positions = label => {
    const id = cell(doc, label).id, line = before.lines.find(l => l.cellId === id), box = before.cells.find(c => c.id === id && c.page === line.page);
    return { line, box, offset: line.y - box.y };
  };
  // Layout adds row-wide padding and the half-border insets to minimum heights.
  expect(positions('Inherited center').offset).toBeCloseTo(42 + 1 / 3);
  expect(positions('Direct top').offset).toBeCloseTo(6 + 1 / 3);
  expect(positions('Direct bottom').offset).toBeCloseTo(78 + 1 / 3);
  // The larger preceding rows move part of this merge onto the next page.
  // Alignment uses the occupied fragment: 6/10px padding, half-border insets,
  // and a 16px line followed by 8px paragraph spacing.
  const merged = positions('Vertical center');
  expect(merged.offset).toBeCloseTo(6 + 1 / 3 + (merged.box.height - 6 - 10 - 2 / 3 - 24) / 2);
  doc.select(0, doc.text.length); doc.setCellVerticalAlignment('top'); const top = layout(doc);
  expect(top.cells).toEqual(before.cells); expect(top.tableWidths).toEqual(before.tableWidths); expect(top.pageCount).toBe(before.pageCount);
  expect(top.lines.map(l => [l.start, l.end, l.page, l.height, l.fragments])).toEqual(before.lines.map(l => [l.start, l.end, l.page, l.height, l.fragments]));
  const shaded = paragraph(doc, 'Bordered center Á😀');
  const oldLine = before.lines.find(l => l.paragraphId === shaded.id), newLine = top.lines.find(l => l.paragraphId === shaded.id);
  const oldBorder = before.paragraphBorders.find(s => s.paragraphId === shaded.id && s.side === 'top'), newBorder = top.paragraphBorders.find(s => s.paragraphId === shaded.id && s.side === 'top');
  expect(oldBorder.y - newBorder.y).toBeCloseTo(oldLine.y - newLine.y);
});

it('keeps page-fragment text and repeated headers inside their cells without moving content between pages', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc);
  expect(result.pageCount).toBeGreaterThan(3); expect(result.repeatedLines.length).toBeGreaterThan(2);
  for (const line of [...result.lines, ...result.repeatedLines].filter(l => l.cellId)) {
    const box = result.cells.find(c => c.id === line.cellId && c.page === line.page);
    expect(line.y).toBeGreaterThanOrEqual(box.y + 6 - 1e-6);
    expect(line.y + line.height).toBeLessThanOrEqual(box.y + box.height - 10 + 1e-6);
  }
  const short = cell(doc, 'Short bottom'), boxes = result.cells.filter(c => c.id === short.id);
  expect(boxes.length).toBeGreaterThan(1);
  const line = result.lines.find(l => l.cellId === short.id);
  expect(line.page).toBe(boxes[0].page); expect(line.y + line.height + 8 + 10 + 1 / 3).toBeCloseTo(boxes[0].y + boxes[0].height);
  const header = cell(doc, 'Header bottom');
  for (const line of result.repeatedLines.filter(l => l.cellId === header.id)) {
    const box = result.cells.find(c => c.id === header.id && c.page === line.page);
    expect(line.y + line.height + 8 + 10 + 1 / 3).toBeCloseTo(box.y + box.height);
  }
});

it('round trips explicit overrides and inheritance restoration with exact full undo and redo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Inherited center'); const before = doc.snapshot();
  doc.setCellVerticalAlignment('bottom'); select(doc, 'Direct bottom'); doc.setCellVerticalAlignment(null);
  let bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(cell(reopened, 'Inherited center')).toMatchObject({ vertical: 'bottom', verticalExplicit: true });
  expect(cell(reopened, 'Direct bottom')).toMatchObject({ vertical: 'center', verticalExplicit: false });
  sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); select(doc, 'Direct bottom'); doc.setCellVerticalAlignment('top');
  reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(cell(reopened, 'Direct bottom').vertical).toBe('top');
});

it('updates mixed selected cells atomically and keeps caret, hit testing and selection on the moved Unicode text', async () => {
  const doc = model(await DocxPackage.open(source));
  const start = doc.text.indexOf('Inherited center'), end = doc.text.indexOf('Direct bottom') + 'Direct bottom'.length;
  doc.select(start, end); expect(doc.cellVerticalAlignment).toBeNull(); doc.setCellVerticalAlignment('bottom'); expect(doc.cellVerticalAlignment).toBe('bottom');
  select(doc, 'Bordered center Á😀'); const before = layout(doc), at = doc.text.indexOf('Á😀', doc.range[0]);
  doc.setCellVerticalAlignment('bottom'); const after = layout(doc), rect = caretRect(after, at);
  expect(rect.y).toBeGreaterThan(caretRect(before, at).y);
  expect(hitTest(after, rect.page, rect.x, rect.y + rect.height / 2)).toBe(at);
  expect(selectionRects(after, at, at + 4)[0].y).toBe(rect.y);
  doc.undo(); expect(layout(doc)).toEqual(before);
});

it('retains alignment through text edits, row insertion, merge splitting and deleting a merged owner row', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  select(doc, 'Direct bottom'); doc.select(doc.range[1]); doc.replace(' edited'); expect(cell(doc, 'Direct bottom edited').vertical).toBe('bottom'); doc.undo();
  select(doc, 'Vertical center'); doc.setCellVerticalAlignment('bottom'); const before = doc.snapshot();
  doc.deleteTablePart('row'); expect(cell(doc, 'Vertical center').vertical).toBe('bottom');
  doc.undo(); expect(doc.snapshot()).toEqual(before);
  doc.splitCell(); expect(cell(doc, 'Vertical center').vertical).toBe('bottom');
  doc.insertTableRow();
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables.flatMap(tableCells).map(c => c.vertical)).toEqual(doc.tables.flatMap(tableCells).map(c => c.vertical));
  expect(() => layout(reopened)).not.toThrow();
});

it('moves inline-picture baselines and image hit targets together inside a tall aligned cell', async () => {
  const doc = model(await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx')));
  const index = doc.paragraphs.findIndex(p => p.cellId && p.runs.some(run => run.image)), p = doc.paragraphs[index];
  doc.select(doc.paragraphOffset(index)); doc.tableContext.row.minHeight = 2160;
  const before = layout(doc); doc.setCellVerticalAlignment('bottom'); const after = layout(doc);
  const old = before.lines.find(line => line.paragraphId === p.id && line.fragments.some(f => f.image));
  const line = after.lines.find(line => line.paragraphId === p.id && line.fragments.some(f => f.image)), image = line.fragments.find(f => f.image);
  expect(line.baseline).toBeGreaterThan(old.baseline); expect(line.fragments).toEqual(old.fragments);
  expect(after.cells).toEqual(before.cells); expect(after.pageCount).toBe(before.pageCount);
  expect(imageAtPoint(after, line.page, image.x + image.width / 2, line.baseline - image.ascent / 2)).toBe(image);
  expect(hitTest(after, line.page, image.x, line.baseline - image.ascent / 2)).toBe(image.start);
});

it.each(['', 'w:val="auto"', 'w:val="Center"', 'w:val=""', 'w:val="top" w:unknown="1"'])('rejects malformed or unsupported active alignment: %s', async attrs => {
  await expect(DocxPackage.open(rewrite('<w:vAlign w:val="top"/>', `<w:vAlign ${attrs}/>`))).rejects.toThrow(/cell alignment/);
});
it.each(['<w:vAlign w:val="top"/><w:vAlign w:val="bottom"/>', '<w:vAlign w:val="top">text</w:vAlign>', '<w:vAlign w:val="top"><w:bottom/></w:vAlign>'])('rejects duplicate or nested cell alignment: %s', async markup => {
  await expect(DocxPackage.open(rewrite('<w:vAlign w:val="top"/>', markup))).rejects.toThrow();
});
it('resets inherited page-only justification to top and rejects invalid inherited values and edits', async () => {
  const pkg = await DocxPackage.open(rewrite('<w:vAlign w:val="center"/>', '<w:vAlign w:val="both"/>', 'word/styles.xml'));
  expect(cell(model(pkg), 'Inherited center').vertical).toBe('top'); sameParts(unzipSync(await save(pkg, model(pkg))), pkg.parts);
  await expect(DocxPackage.open(rewrite('<w:vAlign w:val="center"/>', '<w:vAlign w:val="invalid"/>', 'word/styles.xml'))).rejects.toThrow(/cell alignment/);
  const doc = model(await DocxPackage.open(source)); select(doc, 'Inherited center'); const before = doc.snapshot();
  for (const value of ['both', '', undefined, {}, true]) expect(() => doc.setCellVerticalAlignment(value)).toThrow();
  expect(doc.snapshot()).toEqual(before); expect(doc.undo()).toBe(false);
});
