import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { createDocx, DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { cellContext, tableCells, verticalMerges } from '../src/engine/tables.js';
import { paragraphBackgrounds } from '../src/engine/paragraph-backgrounds.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/cell-shading.docx');
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
const directBlue = '<w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/>';
const geometry = result => ({ pages: result.pageCount, widths: result.tableWidths, lines: [...result.lines, ...result.repeatedLines], cells: result.cells.map(({ fill, ...box }) => box) });

it('resolves atomic style chains, themes, solid foregrounds and explicit resets with exact no-edit export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, shading, fill] of [
    ['Inherited theme', 'C2D69B', '#C2D69B'], ['Direct blue', 'DDEEFF', '#DDEEFF'], ['No fill', 'auto', null],
    ['Solid foreground', '224466', '#224466'], ['Automatic foreground', 'foreground', '#000000'], ['Atomic clear', 'auto', null],
    ['Nil inherited', 'C2D69B', '#C2D69B'], ['Style no fill', 'auto', null], ['Still no fill', 'auto', null],
  ]) expect(cell(doc, text), text).toMatchObject({ shading, fill });
  expect(cell(doc, 'Inherited theme')).toMatchObject({ inheritedShading: 'C2D69B', shadingExplicit: false });
  expect(cell(doc, 'No fill')).toMatchObject({ inheritedShading: 'C2D69B', shadingExplicit: true });
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('does not fall back to table paint when cell-style shading is absent or nil', async () => {
  const from = '<w:shd w:val="clear" w:fill="112233" w:themeFill="accent3" w:themeFillTint="99" w:themeFillShade="10"/>';
  const doc = model(await DocxPackage.open(rewrite(from, '', 'word/styles.xml')));
  expect(cell(doc, 'Inherited theme').fill).toBeNull();
  expect(cell(doc, 'Style no fill').fill).toBeNull();
  const reset = model(await DocxPackage.open(rewrite(from, '<w:shd w:val="nil" w:fill="FF0000"/>', 'word/styles.xml')));
  expect(cell(reset, 'Inherited theme').fill).toBeNull();
});

it('edits fills and restores inheritance with byte-exact full undo and selection history', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Inherited theme'); const before = doc.snapshot();
  doc.setCellShading('224466'); select(doc, 'Direct blue'); doc.setCellShading(null); select(doc, 'No fill'); doc.setCellShading('55aa77');
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(cell(reopened, 'Inherited theme')).toMatchObject({ shading: '224466', shadingExplicit: true });
  expect(cell(reopened, 'Direct blue')).toMatchObject({ shading: 'C2D69B', shadingExplicit: false });
  expect(cell(reopened, 'No fill').fill).toBe('#55AA77'); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(cell(doc, 'No fill').fill).toBe('#55AA77');
});

it('preserves ignored nil until explicitly replaced or removed, even by its current inherited RGB', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Nil inherited'); const before = doc.snapshot();
  expect(doc.setCellShading('C2D69B')).toBe(true);
  let reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(cell(reopened, 'Nil inherited')).toMatchObject({ shadingNil: false, shadingExplicit: true, shading: 'C2D69B' });
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.setCellShading(null); reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(cell(reopened, 'Nil inherited')).toMatchObject({ shadingNil: false, shadingExplicit: false, shading: 'C2D69B' });
});

it('changes every physical vertical-merge segment and preserves fills when splitting or deleting an owner row', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Vertical theme'); doc.setCellShading('CCAAEE');
  const { table, cell: owner } = doc.tableContext;
  const group = verticalMerges(table).get(owner.id).cells; expect(group).toHaveLength(3);
  expect(group.every(c => c.shading === 'CCAAEE' && c.shadingExplicit)).toBe(true);
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables[2].rows.map(r => r.cells[0].shading)).toEqual(['CCAAEE', 'CCAAEE', 'CCAAEE']);
  const before = doc.snapshot(); doc.splitCell(); expect(doc.tables[2].rows.every(r => r.cells[0].fill === '#CCAAEE')).toBe(true);
  doc.undo(); expect(doc.snapshot()).toEqual(before); doc.deleteTablePart('row'); expect(cell(doc, 'Vertical theme').fill).toBe('#CCAAEE');
  doc.undo(); doc.setCellShading(null); expect(doc.tables[2].rows.every(r => r.cells[0].shading === 'C2D69B' && !r.cells[0].shadingExplicit)).toBe(true);
});

it('keeps wrapping, page fragments, repeated header geometry, caret and selection unchanged', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc); expect(before.pageCount).toBeGreaterThan(3); expect(before.repeatedLines.length).toBeGreaterThan(1);
  const at = doc.text.indexOf('Inherited theme') + 4, caret = caretRect(before, at), rectangles = selectionRects(before, at, at + 5);
  doc.select(0, doc.text.length); expect(doc.cellShading).toBeNull(); doc.setCellShading('224466'); expect(doc.cellShading).toBe('224466');
  const after = layout(doc); expect(geometry(after)).toEqual(geometry(before)); expect(after.cells.every(c => c.fill === '#224466')).toBe(true);
  expect(caretRect(after, at)).toEqual(caret); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at); expect(selectionRects(after, at, at + 5)).toEqual(rectangles);
  const backgrounds = paragraphBackgrounds(after.lines, after.page, after.cells), p = paragraph(doc, 'Paragraph layer');
  expect(backgrounds.get(after.lines.find(l => l.paragraphId === p.id))).toMatchObject({ base: '#224466', rect: { color: '#FFFF00' } });
  doc.undo(); expect(layout(doc)).toEqual(before);
});

it('paints an edited header and continued cell on every physical page without shading its transparent neighbor', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Header theme'); doc.setCellShading('55AA77'); select(doc, 'Flowing theme.'); doc.setCellShading('224466');
  const result = layout(doc);
  for (const [label, fill] of [['Header theme', '#55AA77'], ['Flowing theme. '.repeat(150), '#224466'], ['Short no fill', null]]) {
    const boxes = result.cells.filter(c => c.id === cell(doc, label).id); expect(boxes.length).toBeGreaterThan(1); expect(boxes.every(c => c.fill === fill)).toBe(true);
  }
});

it('authors new RGB, clear and solid cells and retains shading through insertion and text edits', async () => {
  const pkg = createDocx(), doc = model(pkg); doc.insertTable(1, 3);
  const cells = tableCells(doc.tables[0]);
  for (const [i, value] of ['224466', 'auto', 'foreground'].entries()) {
    const p = doc.paragraphs.find(p => p.cellId === cells[i].id); doc.select(doc.paragraphOffset(doc.paragraphs.indexOf(p))); doc.setCellShading(value); doc.replace('Cell ' + i);
  }
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(tableCells(reopened.tables[0]).map(c => [c.shading, c.shadingExplicit])).toEqual([['224466', true], ['auto', true], ['foreground', true]]);
  doc.insertTableRow(); const after = model(await DocxPackage.open(await save(pkg, doc)));
  expect(tableCells(after.tables[0]).map(c => c.shading)).toEqual(tableCells(doc.tables[0]).map(c => c.shading));
});

it.each(['<w:shd/>', '<w:shd w:val="pct10"/>', '<w:shd w:val="clear" w:fill="bad"/>', '<w:shd w:val="clear" w:color="bad"/>', '<w:shd w:val="clear" w:themeFill="unknown"/>', '<w:shd w:val="solid" w:themeColor="unknown"/>', '<w:shd w:val="clear" w:themeFillTint="G0"/>', '<w:shd w:val="clear" w:extra="1"/>', '<w:shd w:val="clear">text</w:shd>', '<w:shd w:val="clear"><w:color/></w:shd>', '<w:shd w:val="clear"/><w:shd w:val="solid"/>'])('rejects unsupported active shading before editing: %s', async markup => {
  await expect(DocxPackage.open(rewrite(directBlue, markup))).rejects.toThrow();
});

it.each(['word/document.xml', 'word/styles.xml'])('validates active inherited or direct table shading: %s', async path => {
  const from = path.includes('styles') ? '<w:shd w:val="clear" w:fill="FFE4CC"/>' : '<w:tblLayout w:type="fixed"/>';
  const to = path.includes('styles') ? '<w:shd w:val="pct20"/>' : from + '<w:shd w:val="pct20"/>';
  await expect(DocxPackage.open(rewrite(from, to, path))).rejects.toThrow(/shading/);
});

it('rejects invalid changes without history and treats inheritance outside cells as a no-op', async () => {
  const doc = model(await DocxPackage.open(source)); expect(doc.cellShading).toBeNull(); expect(doc.setCellShading(null)).toBe(false);
  select(doc, 'Inherited theme'); expect(doc.setCellShading(null)).toBe(false); const before = doc.snapshot();
  for (const value of ['', undefined, {}, 123, 'red', 'FFFFFF00']) expect(() => doc.setCellShading(value)).toThrow();
  expect(doc.snapshot()).toEqual(before);
});
