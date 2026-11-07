import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { canvasLetterSpacing } from '../src/engine/canvas-text.js';
import { measureTextGeometry, textTransform } from '../src/engine/text-geometry.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/text-width.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const graphemes = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
const measure = (text, style) => ({ ...fontMetrics(style), width: (graphemes(text).length - (text.match(/AV/g)?.length || 0) / 3) * style.fontSize * 2 / 3 + graphemes(text).length * canvasLetterSpacing(style) });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
const formats = doc => doc.paragraphs.map(p => [p.markFormat.textScale, p.runs.map(r => [r.text, r.textScale, r.characterSpacing, r.verticalAlign, r.fontSize])]);
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

const widthNode = xml => [...xml.getElementsByTagNameNS(W, 'w')].find(n => n.parentNode.localName === 'rPr');

it('imports scaled glyphs, paragraph/character/table inheritance, resets, marks and numbering with exact preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, expected] of [['Wide', 200], ['Compressed', 50], ['Paragraph wide', 125], ['Character compressed', 75], ['Explicit normal', 100], ['Child reset', 100], ['Wide super', 150], ['Narrow sub', 75], ['Percent width', 75], ['Missing value reset', 100], ['Wide header', 150], ['Normal header', 100], ['Table inherited', 150], ['Percent style', 125]]) expect(run(doc, text).textScale, text).toBe(expected);
  expect(doc.paragraphs[11].markFormat.textScale).toBe(150); const result = layout(doc); expect(result.pageCount).toBeGreaterThan(1);
  expect(result.lines.find(l => l.marker).marker).toMatchObject({ textScale: 160, fontSize: 12 }); expect(result.repeatedLines.some(l => l.fragments.some(f => f.text === 'Wide header' && f.textScale === 150))).toBe(true); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it.each([['1', 1], ['600', 600], ['+75', 75], ['0075', 75], ['075%', 75], ['00100%', 100], ['600%', 600]])('reads numeric/percentage width %s and preserves untouched source spelling', async (value, expected) => {
  const pkg = await DocxPackage.open(revise('word/document.xml', xml => widthNode(xml).setAttributeNS(W, 'w:val', value))), doc = model(pkg); expect(run(doc, 'Wide').textScale).toBe(expected);
  select(doc, 'Compressed'); doc.setRunFormat({ bold: true }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Wide').properties).toContain(`w:val="${value}"`);
});

it('edits direct and shared widths, preserves explicit 100 and missing-val resets, round trips and restores full undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Wide'); const initial = doc.snapshot(), before = layout(doc);
  doc.setRunFormat({ textScale: 175 }); doc.editParagraphStyle('WidthParagraph', { run: { textScale: 150 } }); doc.editCharacterStyle('WidthCharacter', { run: { textScale: null } });
  expect(run(doc, 'Character compressed').textScale).toBe(150); expect(run(doc, 'Missing value reset').textScale).toBe(100); expect(run(doc, 'Explicit normal').textScale).toBe(100); expect(run(doc, 'Wide').fontSize).toBe(12);
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(formats(reopened)).toEqual(formats(doc)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc))); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); doc.redo(); doc.redo(); expect(formats(doc)).toEqual(formats(reopened));
});

it('inherits defaults and removes nearer declarations without flattening table styles or direct resets', async () => {
  const pkg = await DocxPackage.open(revise('word/styles.xml', xml => widthNode(xml).setAttributeNS(W, 'w:val', '90'))), doc = model(pkg);
  expect(run(doc, 'Text width Á😀').textScale).toBe(90); expect(run(doc, 'Paragraph wide').textScale).toBe(125); expect(run(doc, 'Wide header').textScale).toBe(150);
  doc.editParagraphStyle('WidthChild', { run: { textScale: null } }); expect(run(doc, 'Child reset').textScale).toBe(125); doc.editParagraphStyle('WidthParagraph', { run: { textScale: null } }); expect(run(doc, 'Child reset').textScale).toBe(90);
  select(doc, 'Text width Á😀'); doc.setRunFormat({ textScale: 100 }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc)); expect(run(reopened, 'Text width Á😀').properties).toContain('<w:w w:val="100"');
});

it('scales glyph advances and script origins horizontally while spacing, stored size and all vertical metrics stay unchanged', () => {
  for (const verticalAlign of ['baseline', 'superscript', 'subscript']) for (const textScale of [1, 50, 150, 600]) {
    const style = { fontSize: 16, italic: true, verticalAlign, baselineShift: 2, characterSpacing: 1, textScale }, normal = { ...style, textScale: 100 };
    const before = measureTextGeometry('Á😀', normal, measure), after = measureTextGeometry('Á😀', style, measure), plain = measureTextGeometry('Á😀', { ...style, characterSpacing: 0 }, measure);
    expect(after.width - plain.width).toBeCloseTo(2 * 4 / 3); expect(after.width - 2 * 4 / 3).toBeCloseTo((before.width - 2 * 4 / 3) * textScale / 100);
    for (const key of ['ascent', 'descent', 'underlineOffset', 'underlineThickness']) expect(after[key], key).toBe(before[key]);
    expect(after.textTransform.offsetX).toBeCloseTo(before.textTransform.offsetX * textScale / 100); expect(after.textTransform.scaleY).toBe(before.textTransform.scaleY); expect(style.fontSize).toBe(16);
  }
  expect(textTransform({ textScale: 100 })).toBeNull();
});

it('shares shaping across colors, changes groups at width boundaries and aligns Unicode carets, selection and decoration', () => {
  const doc = new TextDocument([paragraph('AVAV Á😀')]); doc.select(0, doc.text.length); doc.setRunFormat({ textScale: 175, underline: true, highlight: 'yellow' }); const before = layout(doc);
  doc.select(1, 3); doc.setRunFormat({ color: 'FF0000' }); const after = layout(doc); expect(geometry(after)).toEqual(geometry(before)); expect(after.lines[0].fragments).toHaveLength(1);
  const line = after.lines[0], fragment = line.fragments[0]; expect(line.backgrounds[0].width).toBeCloseTo(fragment.width); expect(line.underlines.reduce((s, u) => s + u.width, 0)).toBeCloseTo(fragment.width);
  const caret = caretRect(after, 7); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(7); expect(selectionRects(after, 0, doc.text.length)[0].width).toBeCloseTo(fragment.width);
  doc.select(0, 2); doc.setRunFormat({ textScale: 75 }); expect(layout(doc).lines[0].fragments).toHaveLength(2);
});

it('remeasures AutoFit, wrapping, pagination and repeated header hits without changing selection or line metrics', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc), at = doc.text.indexOf('Wide header'); doc.select(at, doc.text.length); const range = doc.range; doc.setRunFormat({ textScale: 300 }); const after = layout(doc);
  expect(after.pageCount).toBeGreaterThan(before.pageCount); expect(after.cells.map(c => c.width)).not.toEqual(before.cells.map(c => c.width)); expect(doc.range).toEqual(range);
  const copy = after.repeatedLines.find(l => l.start === at), caret = caretRect(after, at + 2, 'forward', copy.page); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 2); expect(selectionRects(after, at, at + 2).some(r => r.page === copy.page)).toBe(true); doc.undo(); expect(layout(doc)).toEqual(before);
});

it('keeps aligned tab anchors and exact-height clipping while scaling the text fields', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc), tab = result.lines.find(l => l.fragments.some(f => f.text === 'Aligned')), field = tab.fragments.find(f => f.text === 'Field');
  expect(field.width).toBeCloseTo(measure('Field', field).width * 1.25); expect(tab.underlines.some(u => u.x + u.width > field.x)).toBe(true);
  const exact = result.lines.find(l => l.fragments.some(f => f.text === 'Exact wide')), caret = caretRect(result, exact.start + 1); expect(exact.clip).toBe(true); expect(caret.y).toBeGreaterThanOrEqual(exact.y); expect(caret.y + caret.height).toBeLessThanOrEqual(exact.y + exact.height + 1e-6);
});

it('retains widths through empty marks, Unicode future typing, split/merge, mixed selections and undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); doc.select(doc.paragraphOffset(11)); const initial = doc.snapshot(); doc.replace('Á😀'); doc.insertParagraph(); doc.replace('Following'); expect(run(doc, 'Á😀').textScale).toBe(150); expect(run(doc, 'Following').textScale).toBe(150);
  const at = doc.text.indexOf('Following'); doc.select(at - 1, at); doc.replace(''); expect(formats(model(await DocxPackage.open(await save(pkg, doc))))).toEqual(formats(doc)); doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  doc.select(0); doc.setRunFormat({ textScale: 75 }); doc.replace('Pending '); expect(run(doc, 'Pending ').textScale).toBe(75); doc.select(0, doc.text.indexOf('\n')); expect(doc.runFormatting.textScale).toBeNull();
});

it.each(['', '0', '-1', '601', '0%', '601%', '50.5', '50.5%', '+50%', '1e2', 'auto'])('rejects malformed or unsupported active text width %s', async value => {
  await expect(DocxPackage.open(revise('word/document.xml', xml => widthNode(xml).setAttributeNS(W, 'w:val', value)))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('rejects duplicate, nested and unknown width content while preserving unused unsupported definitions', async () => {
  for (const change of [n => n.after(n.cloneNode(true)), n => n.append(node(n.ownerDocument, 'b', '1')), n => n.setAttributeNS(W, 'w:extra', '1')]) await expect(DocxPackage.open(revise('word/document.xml', xml => change(widthNode(xml))))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const bytes = revise('word/styles.xml', xml => { const s = xml.createElementNS(W, 'w:style'); s.setAttributeNS(W, 'w:type', 'character'); s.setAttributeNS(W, 'w:styleId', 'ZeroWidth'); s.append(node(xml, 'name', 'Zero width')); const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'w', '0')); s.append(r); xml.documentElement.append(s); namedStyle(xml, 'WidthCharacter').insertBefore(node(xml, 'basedOn', 'ZeroWidth'), namedStyle(xml, 'WidthCharacter').lastChild); });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); select(doc, 'Character compressed'); const before = doc.snapshot(); expect(run(doc, 'Character compressed').textScale).toBe(75);
  expect(() => doc.editCharacterStyle('WidthCharacter', { run: { textScale: null } })).toThrow(/Text width/); expect(doc.snapshot()).toEqual(before); expect(() => doc.setCharacterStyle('ZeroWidth')).toThrow(/Text width/); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('rejects reversed advances but permits an oversized scaled grapheme', () => {
  const doc = new TextDocument([paragraph('i')]); doc.select(0, 1); doc.setRunFormat({ textScale: 1 }); expect(layout(doc).lines[0].fragments[0].width).toBeGreaterThan(0);
  doc.setRunFormat({ characterSpacing: -.5 }); expect(() => layout(doc)).toThrow(/backwards/); doc.setRunFormat({ characterSpacing: 0, fontSize: 200, textScale: 600 }); expect(layout(doc).lines).toHaveLength(1);
});

it('rejects unsupported numeric edits and picture scaling atomically, while allowing normal pictures and scaled adjacent text', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx')), doc = model(pkg), at = doc.text.indexOf('\uFFFC'); doc.select(at, at + 1); const initial = doc.snapshot();
  for (const textScale of [1, 200, true, null, '100', Infinity, NaN, .5, 0, 601]) expect(() => doc.setRunFormat({ textScale })).toThrow(); expect(doc.snapshot()).toEqual(initial);
  const p = doc.paragraphs.find(p => p.runs.some(r => r.image)); expect(() => doc.editParagraphStyle(p.styleId || 'Normal', { run: { textScale: 150 } })).toThrow(/pictures/); expect(doc.snapshot()).toEqual(initial);
  doc.select(0); doc.setRunFormat({ textScale: 150 }); const pending = doc.snapshot(), image = p.runs.find(r => r.image).image; expect(() => doc.insertImage(image.assetId, { width: image.width, height: image.height })).toThrow(/width to 100%/); expect(doc.snapshot()).toEqual(pending); doc.replace('Scaled next to picture'); expect(run(doc, 'Scaled next to picture').textScale).toBe(150);
  doc.setRunFormat({ textScale: 100 }); expect(() => doc.insertImage(image.assetId, { width: image.width, height: image.height })).not.toThrow(); expect(formats(model(await DocxPackage.open(await save(pkg, doc))))).toEqual(formats(doc));
});

it('rejects scaled imported inline pictures before editable open', async () => {
  const bytes = revise('word/document.xml', xml => { const r = xml.getElementsByTagNameNS(W, 'drawing')[0].parentNode; let p = [...r.children].find(n => n.localName === 'rPr'); if (!p) { p = xml.createElementNS(W, 'w:rPr'); r.prepend(p); } p.append(node(xml, 'w', '150')); }, readFileSync('public/fixtures/inline-images.docx'));
  await expect(DocxPackage.open(bytes)).rejects.toMatchObject({ name: 'UnsupportedDocumentError', message: expect.stringMatching(/pictures/) });
});

it('retains paragraph-mark width on newly authored numbering labels through save/reopen', async () => {
  const pkg = createDocx([paragraph('')]), doc = model(pkg); doc.setRunFormat({ textScale: 175 }); doc.replace('List item'); doc.toggleList('number'); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(layout(reopened).lines[0].marker.textScale).toBe(175); expect(formats(reopened)).toEqual(formats(doc));
});

it('serializes generated numbering-level widths and rejects unsupported active label widths', async () => {
  const pkg = createDocx([paragraph('Item')]), doc = model(pkg); doc.toggleList('number');
  const level = Object.values(doc.numbering.abstracts)[0].levels[0]; level.markerStyle = { textScale: 160, characterSpacing: 1, verticalAlign: 'superscript', fontSize: 12 }; level.alignment = 'right';
  const before = layout(doc), bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(geometry(layout(reopened))).toEqual(geometry(before));
  expect(layout(reopened).lines[0].marker).toMatchObject(level.markerStyle); expect(strFromU8(unzipSync(bytes)['word/numbering.xml'])).toContain('<w:w w:val="160"');
  await expect(DocxPackage.open(revise('word/numbering.xml', xml => widthNode(xml).setAttributeNS(W, 'w:val', '0')))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
