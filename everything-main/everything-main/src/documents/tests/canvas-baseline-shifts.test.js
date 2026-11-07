import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { measureTextGeometry } from '../src/engine/text-geometry.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/baseline-shifts.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ ...fontMetrics(style), width: ([...text].length - (text.match(/AV/g)?.length || 0) / 3) * style.fontSize * 2 / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
const formats = doc => doc.paragraphs.map(p => [p.markFormat.baselineShift, p.runs.map(r => [r.text, r.baselineShift, r.verticalAlign, r.fontSize])]);
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.baseline, l.stops, l.fragments.map(f => [f.text, f.x, f.width, f.ascent, f.descent, f.textTransform])]), cells: result.cells.map(c => [c.page, c.x, c.y, c.width, c.height]) });
function sameParts(actual, expected, except = []) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
function revise(path, change, bytes = source) {
  const parts = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(parts[path]), 'application/xml'); change(xml);
  parts[path] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
const node = (xml, tag, value) => { const n = xml.createElementNS(W, 'w:' + tag); n.setAttributeNS(W, 'w:val', value); return n; };
const namedStyle = (xml, id) => [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === id);

it('imports inherited, reset, combined script and numbering shifts while preserving every original part', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, baselineShift] of [['Raised', 6], ['Lowered', -4], ['Paragraph raised', 4], ['Character lowered', -2], ['Explicit zero', 0], ['Child reset', 0], ['Raised super', 3], ['Lowered sub', -3], ['Universal units', 6], ['Shifted header', 4], ['Zero header', 0], ['Table inherited', 4], ['Universal style', 27]]) expect(run(doc, text).baselineShift, text).toBe(baselineShift);
  expect(doc.paragraphs[11].markFormat.baselineShift).toBe(5); expect(doc.styles.definitions.UniversalShift.run.baselineShift).toBe(27);
  const result = layout(doc); expect(result.pageCount).toBeGreaterThan(1); expect(result.repeatedLines.some(l => l.fragments.some(f => f.text === 'Shifted header' && f.baselineShift === 4))).toBe(true);
  expect(result.lines.find(l => l.marker).marker).toMatchObject({ baselineShift: 2, fontSize: 12, textTransform: { scaleX: 1, scaleY: 1, offsetY: -8 / 3 } });
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it.each([['12', 6], ['-9', -4.5], ['+8', 4], ['6pt', 6], ['-1pc', -12], ['1pi', 12], ['0.125in', 9], ['6.35mm', 18], ['9.525mm', 27], ['1.27cm', 36], ['-0pt', 0]])('reads half-point and universal position %s without altering its spelling', async (value, expected) => {
  const bytes = revise('word/document.xml', xml => xml.getElementsByTagNameNS(W, 'position')[0].setAttributeNS(W, 'w:val', value));
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); expect(run(doc, 'Raised').baselineShift).toBe(expected);
  select(doc, 'Lowered'); doc.setRunFormat({ bold: true }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Raised').properties).toContain(`w:val="${value}"`);
});

it('edits shared and direct positions, retains zero resets and round trips layout with complete undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Raised'); const initial = doc.snapshot(), before = layout(doc);
  doc.setRunFormat({ baselineShift: 8.5 }); doc.editParagraphStyle('ShiftParagraph', { run: { baselineShift: -6 } }); doc.editCharacterStyle('ShiftCharacter', { run: { baselineShift: null } });
  expect(run(doc, 'Character lowered').baselineShift).toBe(-6); expect(run(doc, 'Explicit zero').baselineShift).toBe(0); expect(run(doc, 'Raised').fontSize).toBe(12);
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(formats(reopened)).toEqual(formats(doc)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc))); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); doc.redo(); doc.redo(); expect(formats(doc)).toEqual(formats(reopened));
});

it('resolves nonzero defaults, nearer table/paragraph values and declaration removal without adding shifts', async () => {
  const bytes = revise('word/styles.xml', xml => xml.getElementsByTagNameNS(W, 'docDefaults')[0].getElementsByTagNameNS(W, 'position')[0].setAttributeNS(W, 'w:val', '4'));
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); expect(run(doc, 'Baseline shifts Á😀').baselineShift).toBe(2); expect(run(doc, 'Paragraph raised').baselineShift).toBe(4); expect(run(doc, 'Character lowered').baselineShift).toBe(-2); expect(run(doc, 'Shifted header').baselineShift).toBe(4);
  doc.editParagraphStyle('ShiftChild', { run: { baselineShift: null } }); expect(run(doc, 'Child reset').baselineShift).toBe(4);
  doc.editParagraphStyle('ShiftParagraph', { run: { baselineShift: null } }); expect(run(doc, 'Child reset').baselineShift).toBe(2); expect(run(doc, 'Explicit zero').baselineShift).toBe(0);
  select(doc, 'Baseline shifts Á😀'); doc.setRunFormat({ baselineShift: 0 }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc)); expect(run(reopened, 'Baseline shifts Á😀').properties).toContain('<w:position w:val="0"');
});

it('moves glyphs, highlights, tabs, underlines and carets together without scaling or changing horizontal advances', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc), line = result.lines.find(l => l.fragments.some(f => f.text === 'Raised'));
  for (const text of ['Raised', 'Lowered']) {
    const f = line.fragments.find(f => f.text === text), original = measure(text, f), dy = -f.baselineShift * 4 / 3;
    expect(f.width).toBe(original.width); expect(f.ascent + f.descent).toBeCloseTo(original.ascent + original.descent);
    expect(f.ascent).toBeCloseTo(original.ascent - dy); expect(f.descent).toBeCloseTo(original.descent + dy); expect(f.textTransform).toMatchObject({ scaleX: 1, scaleY: 1, offsetY: dy });
    const background = line.backgrounds.find(b => b.x === f.x), underline = line.underlines.find(u => u.x === f.x); expect(background).toMatchObject({ ascent: f.ascent, descent: f.descent }); expect(underline.offset).toBeCloseTo(original.underlineOffset + dy);
    const at = doc.text.indexOf(text) + 2, caret = caretRect(result, at); expect(caret.y).toBeCloseTo(line.baseline - f.ascent); expect(caret.height).toBeCloseTo(original.ascent + original.descent); expect(hitTest(result, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at);
  }
  const tab = result.lines.find(l => l.fragments.some(f => f.text === 'Shift')), m = measureTextGeometry('', run(doc, 'Shift\tTab'), measure); expect(tab.backgrounds.every(b => b.ascent === m.ascent && b.descent === m.descent)).toBe(true); expect(tab.underlines.every(u => u.offset === m.underlineOffset)).toBe(true);
  const exact = result.lines.find(l => l.fragments.some(f => f.text === 'Exact lowered')), caret = caretRect(result, doc.text.indexOf('Exact lowered') + 1); expect(caret.height).toBeGreaterThanOrEqual(1); expect(caret.y).toBeGreaterThanOrEqual(exact.y); expect(caret.y + caret.height).toBeLessThanOrEqual(exact.y + exact.height + 1e-6);
});

it('combines manual shifts with superscript/subscript and retains shaping across color boundaries', () => {
  for (const verticalAlign of ['baseline', 'superscript', 'subscript']) {
    const style = { fontSize: 16, italic: true, verticalAlign }, before = measureTextGeometry('AV', style, measure), after = measureTextGeometry('AV', { ...style, baselineShift: -3.5 }, measure);
    expect(after.width).toBe(before.width); expect(after.ascent).toBeCloseTo(before.ascent - 14 / 3); expect(after.descent).toBeCloseTo(before.descent + 14 / 3); expect(after.underlineOffset).toBeCloseTo(before.underlineOffset + 14 / 3);
  }
  const doc = new TextDocument([paragraph('AVAV')]); doc.select(0, 4); doc.setRunFormat({ baselineShift: 4, underline: true }); const before = layout(doc);
  doc.select(1, 3); doc.setRunFormat({ color: 'FF0000' }); expect(geometry(layout(doc))).toEqual(geometry(before)); expect(layout(doc).lines[0].fragments).toHaveLength(1);
  doc.select(2, 4); doc.setRunFormat({ baselineShift: -4 }); const after = layout(doc); expect(after.lines[0].fragments).toHaveLength(2); expect(new Set(after.lines[0].underlines.map(u => u.offset)).size).toBe(2);
});

it('types Unicode through empty shifted marks, pending formatting and split/merge with history', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), at = doc.paragraphOffset(11); doc.select(at); const initial = doc.snapshot(), before = layout(doc), line = before.lines.find(l => l.start === at), caret = caretRect(before, at);
  expect(caret.y).toBeCloseTo(line.baseline - fontMetrics({ fontSize: 12 }).ascent - 20 / 3);
  doc.replace('Á😀'); doc.insertParagraph(); doc.replace('Following'); expect(run(doc, 'Á😀').baselineShift).toBe(5); expect(run(doc, 'Following').baselineShift).toBe(5);
  const mergeAt = doc.text.indexOf('Following'); doc.select(mergeAt - 1, mergeAt); doc.replace(''); expect(doc.paragraphs.find(p => paragraphText(p) === 'Á😀Following').runs.every(r => r.baselineShift === 5)).toBe(true);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc));
  doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  doc.select(0); doc.setRunFormat({ baselineShift: -2.5 }); doc.replace('Pending '); expect(run(doc, 'Pending ').baselineShift).toBe(-2.5); doc.select(0, doc.text.indexOf('\n')); expect(doc.runFormatting.baselineShift).toBeNull();
});

it('repaginates shifted rows and repeated headers while preserving AutoFit widths, source selection and undo', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc), at = doc.text.indexOf('Shifted header'); doc.select(at, doc.text.length); const range = doc.range;
  doc.setRunFormat({ baselineShift: 30 }); const after = layout(doc); expect(after.pageCount).toBeGreaterThan(before.pageCount);
  const widths = result => [...new Set(result.cells.map(c => c.width))]; expect(widths(after)).toEqual(widths(before)); expect(doc.range).toEqual(range);
  const copy = after.repeatedLines.find(l => l.start === at), caret = caretRect(after, at + 2, 'forward', copy.page); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 2); expect(selectionRects(after, at, at + 2).some(r => r.page === copy.page)).toBe(true);
  doc.undo(); expect(layout(doc)).toEqual(before);
});

it.each(['', 'abc', '2.5', '0.25pt', '401', '-401', '1e2', 'Infinity', '+1pt'])('rejects malformed or unsupported active position %s', async value => {
  const bytes = revise('word/document.xml', xml => xml.getElementsByTagNameNS(W, 'position')[0].setAttributeNS(W, 'w:val', value)); await expect(DocxPackage.open(bytes)).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
it('rejects malformed element content but preserves unused or masked unsupported inherited measurements', async () => {
  for (const change of [n => n.removeAttributeNS(W, 'val'), n => n.after(n.cloneNode(true)), n => n.append(n.ownerDocument.createElementNS(W, 'w:b')), n => n.setAttributeNS(W, 'w:extra', '1')]) await expect(DocxPackage.open(revise('word/document.xml', xml => change(xml.getElementsByTagNameNS(W, 'position')[0])))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const bytes = revise('word/styles.xml', xml => { const s = xml.createElementNS(W, 'w:style'); s.setAttributeNS(W, 'w:type', 'paragraph'); s.setAttributeNS(W, 'w:styleId', 'UnsupportedShift'); s.append(node(xml, 'name', 'Unsupported shift')); const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'position', '600')); s.append(r); xml.documentElement.append(s); namedStyle(xml, 'ShiftChild').getElementsByTagNameNS(W, 'basedOn')[0].setAttributeNS(W, 'w:val', 'UnsupportedShift'); });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); expect(run(doc, 'Child reset').baselineShift).toBe(0); select(doc, 'Child reset'); const initial = doc.snapshot(); expect(() => doc.setParagraphStyle('UnsupportedShift')).toThrow(/Baseline shift/); expect(doc.snapshot()).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits and inherits image baseline shifts while rejecting malformed shifts atomically', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx')), doc = model(pkg), at = doc.text.indexOf('\uFFFC'); doc.select(at, at + 1); const initial = doc.snapshot();
  for (const baselineShift of [true, null, '4', Infinity, NaN, .25, 201]) expect(() => doc.setRunFormat({ baselineShift })).toThrow(); expect(doc.snapshot()).toEqual(initial);
  const pictureP = doc.paragraphs.find(p => p.runs.some(r => r.image)); doc.editParagraphStyle(pictureP.styleId || 'Normal', { run: { baselineShift: 3 } });
  expect(doc.paragraphs.find(p => p.id === pictureP.id).runs.find(r => r.image).baselineShift).toBe(3);
  doc.setRunFormat({ baselineShift: -2 });
  let reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).baselineShift).toBe(-2);
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  doc.select(0); doc.setRunFormat({ baselineShift: 3 }); const image = pictureP.runs.find(r => r.image).image;
  doc.insertImage(image.assetId, { width: image.width, height: image.height });
  reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.paragraphs[0].runs[0].baselineShift).toBe(3);
});

it('retains a shifted paragraph mark on a freshly authored list through save/reopen', async () => {
  const pkg = createDocx([paragraph('')]), doc = model(pkg); doc.setRunFormat({ baselineShift: -3.5 }); doc.replace('List item'); doc.toggleList('number');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(layout(reopened).lines[0].marker.baselineShift).toBe(-3.5); expect(formats(reopened)).toEqual(formats(doc));
});
