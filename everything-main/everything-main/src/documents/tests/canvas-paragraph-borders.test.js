import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, selectionRects, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { BORDER_SIDES, borderWidth, sameParagraphBorders } from '../src/engine/paragraph-borders.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const source = readFileSync('public/fixtures/paragraph-borders.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const p = (doc, text) => doc.paragraphs.find(p => paragraphText(p) === text);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const side = (style = 'single', color = '224466', size = 8, space = 2) => ({ style, color, size, space });
const clear = () => Object.fromEntries(BORDER_SIDES.map(name => [name, side('none')]));
function equalParts(actual, expected, except = []) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
const revise = (from, to, path = 'word/document.xml') => {
  const parts = unzipSync(source); expect(strFromU8(parts[path])).toContain(from);
  parts[path] = strToU8(strFromU8(parts[path]).replace(from, to)); return zipSync(parts);
};

it('inherits each border side, replaces each side atomically, and preserves a no-edit package exactly', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), borders = p(doc, 'Joined first').format.paragraphBorders;
  expect(borders.top).toMatchObject(side()); expect(borders.left).toMatchObject(side('dotted', '224466', 12, 3));
  expect(borders.between).toMatchObject(side('single', 'CC3300', 4, 12));
  expect(sameParagraphBorders(borders, p(doc, 'Joined second').format.paragraphBorders)).toBe(true);
  expect(sameParagraphBorders(borders, p(doc, 'Different spacing breaks the group').format.paragraphBorders)).toBe(false);
  expect(p(doc, 'Partial direct border').format.paragraphBorders).toMatchObject({ top: side(), left: side('dotted', '224466', 12, 3), right: side('nil') });
  expect(Object.values(p(doc, 'No borders').format.paragraphBorders).every(b => borderWidth(b) === 0)).toBe(true);
  expect(p(doc, 'Themed bottom').format.paragraphBorders.bottom).toMatchObject({ style: 'double', size: 16, space: 3, color: 'C2D69B', theme: { themeColor: 'accent3', themeTint: '99', themeShade: '00' } });
  equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits individual sides without freezing other inherited sides, and supports exact undo/redo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Joined first'); const before = doc.snapshot();
  doc.setParagraphFormat({ paragraphBorders: { right: side('dashed', 'aabbcc', 12, 3) } });
  doc.setParagraphFormat({ paragraphBorders: { bottom: side('double', 'CC3300', 16, 4) } });
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(p(reopened, 'Joined first').format.paragraphBorders).toMatchObject({ top: side(), left: side('dotted', '224466', 12, 3), right: side('dashed', 'AABBCC', 12, 3), bottom: side('double', 'CC3300', 16, 4) });
  equalParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.editParagraphStyle('CanvasBorderBase', { paragraph: { paragraphBorders: { top: side('triple', '112233', 24, 1) } } });
  expect(p(doc, 'Joined first').format.paragraphBorders.top).toMatchObject(side('triple', '112233', 24, 1));
  expect(p(doc, 'Joined first').format.paragraphBorders.right).toMatchObject(side('dashed', 'AABBCC', 12, 3));
});

it('removes one style-side declaration or a whole border set to restore inheritance, including consecutive edits', async () => {
  let pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.editParagraphStyle('CanvasBorderChild', { paragraph: { paragraphBorders: { right: side('double', 'CC3300', 16, 3) } } });
  pkg = await DocxPackage.open(await save(pkg, doc)); doc = model(pkg);
  doc.editParagraphStyle('CanvasBorderChild', { paragraph: { paragraphBorders: { left: null } } });
  expect(p(doc, 'Joined first').format.paragraphBorders.left).toMatchObject(side());
  doc.editParagraphStyle('CanvasBorderChild', { paragraph: { paragraphBorders: null } });
  doc.editParagraphStyle('CanvasBorderChild', { paragraph: { paragraphBorders: { left: side('dashed', '112233') } } });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(p(reopened, 'Joined first').format.paragraphBorders.left).toMatchObject(side('dashed', '112233'));
  expect(p(reopened, 'Joined first').format.paragraphBorders.right).toMatchObject(side());
  expect(p(reopened, 'Partial direct border').format.paragraphBorders.right.style).toBe('nil');
});

it('writes explicit resets, replaces an edited theme, and retains unrelated theme declarations', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Themed bottom');
  doc.setParagraphFormat({ paragraphBorders: { left: side('single', '445566') } });
  let xml = strFromU8(unzipSync(await save(pkg, doc))['word/document.xml']); expect(xml).toContain('w:themeColor="accent3"');
  doc.setParagraphFormat({ paragraphBorders: clear() });
  xml = strFromU8(unzipSync(await save(pkg, doc))['word/document.xml']); expect(xml).not.toContain('w:themeColor="accent3"');
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(Object.values(p(reopened, 'Themed bottom').format.paragraphBorders).every(b => b.style === 'none')).toBe(true);
});

it('uses the format defaults for omitted size/color/space instead of inheriting attributes from the same side', async () => {
  const bytes = revise('<w:right w:val="nil" w:sz="8" w:space="2" w:color="224466"/>', '<w:right w:val="single"/>');
  const doc = model(await DocxPackage.open(bytes)), border = p(doc, 'Partial direct border').format.paragraphBorders.right;
  expect(border).toMatchObject({ style: 'single', size: 0, space: 0, color: 'auto' }); expect(borderWidth(border)).toBe(0);
});

it.each([
  '<w:bottom w:val="wave" w:sz="8"/>',
  '<w:bottom w:val="apples" w:sz="8"/>',
  '<w:bottom w:sz="8"/>',
  '<w:bottom w:val="single" w:space="32"/>',
  '<w:bottom w:val="single" w:sz="-1"/>',
  '<w:bottom w:val="single" w:sz="1.5"/>',
  '<w:bottom w:val="single" w:sz="8" w:shadow="1"/>',
  '<w:bottom w:val="single" w:sz="8" w:frame="invalid"/>',
  '<w:bottom w:val="single" w:color="invalid"/>',
  '<w:bottom w:val="single" w:themeColor="unknown"/>',
  '<w:bottom w:val="single">stray text</w:bottom>',
  '<w:bottom w:val="single"><w:t>nested</w:t></w:bottom>',
  '<w:bottom w:val="single"/><w:bottom w:val="single"/>',
])('rejects unsupported or malformed active borders: %s', async markup => {
  await expect(DocxPackage.open(revise('<w:bottom w:val="single" w:sz="8" w:space="4" w:color="224466"/>', markup))).rejects.toThrow();
});

it('normalizes out-of-range positive widths as CT_Border permits, retaining the original declarations', async () => {
  for (const [raw, expected] of [['1', 2], ['100', 96]]) {
    const pkg = await DocxPackage.open(revise('<w:bottom w:val="single" w:sz="8" w:space="4"', `<w:bottom w:val="single" w:sz="${raw}" w:space="4"`)), doc = model(pkg);
    expect(p(doc, 'Different spacing breaks the group').format.paragraphBorders.bottom.size).toBe(expected);
    equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
  }
});

it('joins identical paragraphs with between strokes, splits differing borders and connects different indents', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc);
  const strokes = label => result.paragraphBorders.filter(s => s.paragraphId === p(doc, label).id);
  expect(strokes('Joined first').map(s => s.side).sort()).toEqual(['between', 'left', 'right', 'top']);
  expect(strokes('Joined second').map(s => s.side).sort()).toEqual(['bottom', 'left', 'right']);
  expect(strokes('Different spacing breaks the group').map(s => s.side).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  const first = result.lines.find(l => l.paragraphId === p(doc, 'Joined first').id), second = result.lines.find(l => l.paragraphId === p(doc, 'Joined second').id);
  const between = strokes('Joined first').find(s => s.side === 'between');
  expect(between.y).toBeCloseTo(first.y + first.height + 8 + 16); expect(between.height).toBeCloseTo(4 / 6); expect(second.y).toBeCloseTo(between.y + between.height + 16);
  expect(strokes('Centered box').some(s => s.horizontal && ['left', 'right'].includes(s.side))).toBe(true);
});

it('keeps every border inside its page and cell, repeats header borders, and does not frame virtual caret lines', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc);
  expect(result.pageCount).toBeGreaterThan(2); expect(result.repeatedLines.length).toBeGreaterThan(0);
  for (const stroke of result.paragraphBorders) {
    expect(stroke.y).toBeGreaterThanOrEqual(result.page.top - 1e-6);
    expect(stroke.y + stroke.height).toBeLessThanOrEqual(result.page.height - result.page.bottom + 1e-6);
    const cell = result.cells.find(c => c.id === stroke.cellId && c.page === stroke.page);
    if (cell) {
      expect(stroke.x).toBeGreaterThanOrEqual(cell.x - 1e-6); expect(stroke.x + stroke.width).toBeLessThanOrEqual(cell.x + cell.width + 1e-6);
      expect(stroke.y).toBeGreaterThanOrEqual(cell.y - 1e-6); expect(stroke.y + stroke.height).toBeLessThanOrEqual(cell.y + cell.height + 1e-6);
    }
  }
  const header = p(doc, 'Bordered header');
  const copies = new Set(result.repeatedLines.filter(l => l.paragraphId === header.id).map(l => l.page)); expect(copies.size).toBeGreaterThan(0);
  for (const page of copies) expect(result.paragraphBorders.filter(s => s.paragraphId === header.id && s.page === page)).toHaveLength(4);
});

it('retains text shaping, adjusts vertical placement, and restores caret, selection and hit testing with undo', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Paragraph borders'); const before = layout(doc), at = doc.text.indexOf('Á😀');
  doc.setParagraphFormat({ paragraphBorders: { top: side(), bottom: side(), left: side(), right: side() } });
  const after = layout(doc), a = before.lines[0], b = after.lines[0];
  expect(b.y - a.y).toBeCloseTo(4); expect(b.height).toBe(a.height);
  expect(b.fragments.map(f => [f.text, f.x, f.width])).toEqual(a.fragments.map(f => [f.text, f.x, f.width]));
  const caret = caretRect(after, at); expect(caret.y - caretRect(before, at).y).toBeCloseTo(4);
  expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at);
  expect(selectionRects(after, at, at + 4)[0].y - selectionRects(before, at, at + 4)[0].y).toBeCloseTo(4);
  doc.undo(); expect(layout(doc)).toEqual(before);
});

it('moves a terminal page-break paragraph and its borders when the current page is full', () => {
  const paragraphs = [paragraph('a\vb\vc\vd\ve', { format: { spaceAfter: 0 } }), paragraph('\f', { format: { spaceAfter: 0, paragraphBorders: { top: side(), bottom: side() } } })];
  const result = layoutDocument(paragraphs, measure, { width: 400, height: 140, left: 30, right: 30, top: 20, bottom: 20 });
  expect(result.pageCount).toBe(3);
  expect(result.paragraphBorders.map(stroke => stroke.page)).toEqual([1, 1]);
  for (const stroke of result.paragraphBorders) expect(stroke.y + stroke.height).toBeLessThanOrEqual(120);
  expect(result.lines.at(-1).virtual).toBe(true);
});

it('retains inherited borders through Unicode paragraph splitting, merging, saving and full undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  const at = doc.text.indexOf('Joined second') + 6; doc.select(at); const before = doc.snapshot();
  const borders = p(doc, 'Joined second').format.paragraphBorders;
  doc.replace('\nÁ😀 ');
  expect(p(doc, 'Joined').format.paragraphBorders).toEqual(borders);
  expect(p(doc, 'Á😀  second').format.paragraphBorders).toEqual(borders);
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.text).toBe(doc.text); expect(p(reopened, 'Á😀  second').format.paragraphBorders).toEqual(borders);
  doc.select(at, at + 1); doc.replace('');
  expect(p(doc, 'JoinedÁ😀  second').format.paragraphBorders).toEqual(borders);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before);
  equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('retains frame flags for symmetric supported strokes and ignores legacy bar ink without dropping its declaration', async () => {
  const pkg = await DocxPackage.open(revise('<w:right w:val="nil" w:sz="8" w:space="2" w:color="224466"/>', '<w:right w:val="double" w:sz="8" w:space="2" w:color="224466" w:frame="true"/><w:bar w:val="single" w:sz="8"/>'));
  const doc = model(pkg), border = p(doc, 'Partial direct border').format.paragraphBorders;
  expect(border.right.frame).toBe(true); expect(border.bar.size).toBe(8);
  expect(layout(doc).paragraphBorders.some(stroke => stroke.side === 'bar')).toBe(false);
  equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});
