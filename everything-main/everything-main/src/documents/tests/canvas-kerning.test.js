import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { canvasLetterSpacing, setCanvasTextStyle } from '../src/engine/canvas-text.js';
import { checkedKerning, kerningEnabled } from '../src/engine/kerning.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/kerning.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const graphemes = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
const measure = (text, style) => ({ ...fontMetrics(style), width: (graphemes(text).length - (kerningEnabled(style) ? (text.match(/AV|WA|To/g)?.length || 0) / 3 : 0)) * style.fontSize * 2 / 3 + graphemes(text).length * canvasLetterSpacing(style) });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
const formats = doc => doc.paragraphs.map(p => [p.markFormat.kerning, p.runs.map(r => [r.text, r.kerning, r.fontSize])]);
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.baseline, l.stops, l.fragments.map(f => [f.text, f.x, f.width])]), cells: result.cells.map(c => [c.page, c.x, c.y, c.width, c.height]) });
function sameParts(actual, expected, except = []) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
function revise(path, change, bytes = source) {
  const parts = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(parts[path]), 'application/xml'); change(xml);
  parts[path] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
const node = (xml, tag, value) => { const n = xml.createElementNS(W, 'w:' + tag); if (value !== undefined) n.setAttributeNS(W, 'w:val', value); return n; };
const kern = xml => xml.getElementsByTagNameNS(W, 'kern')[0];
const namedStyle = (xml, id) => [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === id);

it('imports thresholds, default off, direct resets, inheritance, empty marks and numbering with exact preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, threshold, enabled] of [['Kerning Á😀', 0, false], ['Enabled AVATAR', 12, true], ['Disabled AVATAR', 0, false], ['Below AVATAR', 14, false], ['At AVATAR', 14, true], ['Above AVATAR', 14, true], ['Paragraph AVATAR', 12, true], ['Character AVATAR', 14, false], ['Child AVATAR', 0, false], ['Direct zero AVATAR', 0, false], ['Universal AVATAR', 12, true], ['Super AVATAR', 20, true], ['Sub AVATAR', 20, true], ['Header AVATAR', 12, true], ['Plain header', 0, false]]) { expect(run(doc, text).kerning, text).toBe(threshold); expect(kerningEnabled(run(doc, text)), text).toBe(enabled); }
  expect(doc.paragraphs[13].markFormat.kerning).toBe(12); expect(layout(doc).lines.find(l => l.marker).marker.kerning).toBe(12); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it.each([['+24', 12], ['0024', 12], ['0', 0], ['-0', 0], ['1', .5], ['3277', 1638.5], ['12pt', 12], ['1pc', 12], ['1pi', 12], ['.5in', null], ['0.5in', 36], ['25.4mm', 72], ['2.54cm', 72]])('interprets threshold %s without rewriting untouched XML', async (value, expected) => {
  const bytes = revise('word/document.xml', xml => kern(xml).setAttributeNS(W, 'w:val', value));
  if (expected === null) { await expect(DocxPackage.open(bytes)).rejects.toMatchObject({ name: 'UnsupportedDocumentError' }); return; }
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); expect(run(doc, 'Enabled AVATAR').kerning).toBe(expected); select(doc, 'Disabled AVATAR'); doc.setRunFormat({ bold: true });
  const out = model(await DocxPackage.open(await save(pkg, doc))); expect(run(out, 'Enabled AVATAR').properties).toContain(`w:val="${value}"`);
});

it('edits shared and direct thresholds, removes declarations, recomputes geometry, round trips and restores full undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Enabled AVATAR'); const initial = doc.snapshot(), before = layout(doc);
  doc.setRunFormat({ kerning: 14 }); doc.editParagraphStyle('KernParagraph', { run: { kerning: 10 } }); doc.editCharacterStyle('KernCharacter', { run: { kerning: null } });
  expect(run(doc, 'Character AVATAR').kerning).toBe(10); expect(run(doc, 'Child AVATAR').kerning).toBe(0); expect(run(doc, 'Direct zero AVATAR').kerning).toBe(0); expect(doc.selection).toEqual(initial.selection);
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(formats(reopened)).toEqual(formats(doc)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc))); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); doc.redo(); doc.redo(); expect(formats(doc)).toEqual(formats(reopened));
});

it('inherits defaults and restores a removed zero override without flattening declarations', async () => {
  const pkg = await DocxPackage.open(revise('word/styles.xml', xml => { const rpr = xml.getElementsByTagNameNS(W, 'rPrDefault')[0].firstElementChild; rpr.insertBefore(node(xml, 'kern', '20'), [...rpr.children].find(n => n.localName === 'sz')); })), doc = model(pkg);
  expect(run(doc, 'Kerning Á😀').kerning).toBe(10); expect(run(doc, 'Paragraph AVATAR').kerning).toBe(12); doc.editParagraphStyle('KernChild', { run: { kerning: null } }); expect(run(doc, 'Child AVATAR').kerning).toBe(12);
  doc.editParagraphStyle('KernParagraph', { run: { kerning: null } }); expect(run(doc, 'Child AVATAR').kerning).toBe(10); expect(run(doc, 'Direct zero AVATAR').kerning).toBe(0); expect(formats(model(await DocxPackage.open(await save(pkg, doc))))).toEqual(formats(doc));
});

it('sets explicit Canvas kerning for both measurement and paint, compares stored font size, and fails without support', () => {
  const context = { font: '', fontKerning: 'auto', letterSpacing: '0px' };
  for (const [style, expected] of [[{}, 'none'], [{ kerning: 0, fontSize: 200 }, 'none'], [{ kerning: 14, fontSize: 12 }, 'none'], [{ kerning: 14, fontSize: 14 }, 'normal'], [{ kerning: 14, fontSize: 20, verticalAlign: 'superscript', textScale: 50 }, 'normal']]) { setCanvasTextStyle(context, style); expect(context.fontKerning).toBe(expected); }
  expect(() => setCanvasTextStyle({ font: '', letterSpacing: '0px' }, {})).toThrow(/font-kerning support/); expect(() => setCanvasTextStyle(null, {})).toThrow(/Canvas 2D/);
});

it('reshapes at effective kerning boundaries while colors, equal modes and selection share a single shaped fragment', () => {
  const doc = new TextDocument([paragraph('AVAV Á😀')]); doc.select(0, doc.text.length); doc.setRunFormat({ kerning: 12, underline: true, highlight: 'yellow' }); const before = layout(doc);
  doc.select(1, 3); doc.setRunFormat({ color: 'FF0000', kerning: 10 }); const after = layout(doc); expect(geometry(after)).toEqual(geometry(before)); expect(after.lines[0].fragments).toHaveLength(1);
  const line = after.lines[0], fragment = line.fragments[0]; expect(line.backgrounds[0].width).toBeCloseTo(fragment.width); expect(line.underlines.reduce((s, u) => s + u.width, 0)).toBeCloseTo(fragment.width);
  const caret = caretRect(after, 7); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(7); expect(selectionRects(after, 0, doc.text.length)[0].width).toBeCloseTo(fragment.width);
  doc.select(0, 2); doc.setRunFormat({ kerning: 0 }); expect(layout(doc).lines[0].fragments).toHaveLength(2); expect(layout(doc).lines[0].width).toBeGreaterThan(line.width);
});

it('reflows wrapping, pagination, AutoFit and repeated header hits when a font crosses its threshold', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Header AVATAR'); doc.fitTable('contents'); const before = layout(doc); select(doc, 'Below AVATAR'); doc.setRunFormat({ fontSize: 14 }); expect(kerningEnabled(run(doc, 'Below AVATAR'))).toBe(true); doc.undo();
  doc.select(0, doc.text.length); doc.setRunFormat({ kerning: 0 }); const after = layout(doc); expect(after.cells.map(c => c.width)).not.toEqual(before.cells.map(c => c.width));
  const at = doc.text.indexOf('Header AVATAR'), repeated = after.repeatedLines.find(l => l.start === at), caret = caretRect(after, at + 2, 'forward', repeated.page); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 2); expect(selectionRects(after, at, at + 2).some(r => r.page === repeated.page)).toBe(true); doc.undo(); expect(layout(doc)).toEqual(before);
  const ps = [paragraph('AVAV AVAV AVAV AVAV', { format: { spaceAfter: 0 }, runs: [{ text: 'AVAV AVAV AVAV AVAV', kerning: 12 }] })]; const small = { width: 90, height: 66, margin: 10 }; const enabled = layoutDocument(ps, measure, small); ps[0].runs[0].kerning = 0; const disabled = layoutDocument(ps, measure, small); expect(disabled.lines.length).toBeGreaterThan(enabled.lines.length); expect(disabled.pageCount).toBeGreaterThan(enabled.pageCount);
});

it('retains thresholds through empty marks, Unicode typing, split/merge, mixed selections and undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); doc.select(doc.paragraphOffset(13)); const initial = doc.snapshot(); doc.replace('Á😀'); doc.insertParagraph(); doc.replace('Following'); expect(run(doc, 'Following').kerning).toBe(12);
  const at = doc.text.indexOf('Following'); doc.select(at - 1, at); doc.replace(''); expect(formats(model(await DocxPackage.open(await save(pkg, doc))))).toEqual(formats(doc)); doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  select(doc, 'Enabled AVATAR\nDisabled AVATAR'); expect(doc.runFormatting.kerning).toBeNull(); doc.select(0); doc.setRunFormat({ kerning: 14 }); doc.replace('Pending '); expect(run(doc, 'Pending ').kerning).toBe(14);
});

it.each([null, '', '-1', '3278', '1.5', '12.25pt', '+12pt', 'auto', '1e2'])('rejects malformed or unsupported active threshold %s', async value => {
  await expect(DocxPackage.open(revise('word/document.xml', xml => { if (value === null) kern(xml).removeAttributeNS(W, 'val'); else kern(xml).setAttributeNS(W, 'w:val', value); }))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('rejects duplicate, nested and unknown content, preserves unused invalid styles, and rolls back exposing invalid ancestors', async () => {
  for (const change of [n => n.after(n.cloneNode(true)), n => n.append(node(n.ownerDocument, 'b')), n => n.setAttributeNS(W, 'w:extra', '1')]) await expect(DocxPackage.open(revise('word/document.xml', xml => change(kern(xml))))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const bytes = revise('word/styles.xml', xml => { const s = xml.createElementNS(W, 'w:style'); s.setAttributeNS(W, 'w:type', 'character'); s.setAttributeNS(W, 'w:styleId', 'BadKern'); s.append(node(xml, 'name', 'Bad kerning')); const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'kern', '3278')); s.append(r); xml.documentElement.append(s); const child = namedStyle(xml, 'KernCharacter'); child.insertBefore(node(xml, 'basedOn', 'BadKern'), child.lastChild); });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); select(doc, 'Character AVATAR'); const initial = doc.snapshot(); expect(() => doc.editCharacterStyle('KernCharacter', { run: { kerning: null } })).toThrow(/kerning thresholds/); expect(() => doc.setCharacterStyle('BadKern')).toThrow(/kerning thresholds/); expect(doc.snapshot()).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('rejects unsupported ANSI kerning settings while preserving explicit false values', async () => {
  for (const tag of ['useAnsiKerningPairs']) {
    const reviseFlag = value => revise('word/settings.xml', xml => (tag === 'useAnsiKerningPairs' ? xml.getElementsByTagNameNS(W, 'compat')[0] : xml.documentElement).append(node(xml, tag, value)));
    await expect(DocxPackage.open(reviseFlag('1'))).rejects.toMatchObject({ name: 'UnsupportedDocumentError', message: expect.stringContaining(tag) });
    await expect(DocxPackage.open(reviseFlag('yes'))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
    const pkg = await DocxPackage.open(reviseFlag('0')), doc = model(pkg); select(doc, 'Enabled AVATAR'); doc.setRunFormat({ kerning: 14 }); expect(unzipSync(await save(pkg, doc))['word/settings.xml']).toEqual(pkg.parts['word/settings.xml']);
  }
});

it('serializes generated numbering thresholds and rejects unsupported active label thresholds', async () => {
  const pkg = createDocx([paragraph('Item')]), doc = model(pkg); doc.toggleList('number'); Object.values(doc.numbering.abstracts)[0].levels[0].markerStyle = { kerning: 10 };
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(layout(reopened).lines[0].marker.kerning).toBe(10); expect(strFromU8(unzipSync(bytes)['word/numbering.xml'])).toContain('<w:kern w:val="20"');
  await expect(DocxPackage.open(revise('word/numbering.xml', xml => kern(xml).setAttributeNS(W, 'w:val', '3278')))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('preserves kerning beside and on inline images, and validates edit values atomically', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx')), doc = model(pkg); doc.select(0, doc.text.length); const initial = doc.snapshot();
  for (const value of [true, null, '12', Infinity, NaN, .25, -1, 1639]) { expect(() => doc.setRunFormat({ kerning: value })).toThrow(); expect(() => checkedKerning(value)).toThrow(); } expect(doc.snapshot()).toEqual(initial);
  doc.setRunFormat({ kerning: 12 }); const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(formats(reopened)).toEqual(formats(doc)); for (const [path, data] of Object.entries(pkg.parts)) if (path.startsWith('word/media/')) expect(unzipSync(bytes)[path]).toEqual(data);
});
