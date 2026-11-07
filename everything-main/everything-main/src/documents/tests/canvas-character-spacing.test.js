import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { canvasLetterSpacing, setCanvasTextStyle } from '../src/engine/canvas-text.js';
import { measureTextGeometry } from '../src/engine/text-geometry.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/character-spacing.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const graphemes = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
const measure = (text, style) => ({ ...fontMetrics(style), width: (graphemes(text).length - (text.match(/AV/g)?.length || 0) / 3) * style.fontSize * 2 / 3 + graphemes(text).length * canvasLetterSpacing(style) });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
const formats = doc => doc.paragraphs.map(p => [p.markFormat.characterSpacing, p.runs.map(r => [r.text, r.characterSpacing, r.verticalAlign, r.fontSize])]);
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

const spacingNode = xml => [...xml.getElementsByTagNameNS(W, 'spacing')].find(n => n.parentNode.localName === 'rPr');

it('imports expanded/condensed, inherited, reset and symbol spacing with byte-exact no-edit preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, expected] of [['Expanded', 2], ['Condensed', -.5], ['Paragraph expanded', 1.25], ['Character condensed', -.25], ['Explicit zero', 0], ['Child reset', 0], ['Spaced super', 1], ['Spaced sub', 1], ['Universal units', .5], ['Spaced header', 2], ['Zero header', 0], ['Table inherited', 2], ['Universal style', 1.8]]) expect(run(doc, text).characterSpacing, text).toBe(expected);
  expect(doc.styles.definitions.UniversalSpacing.run.characterSpacing).toBe(1.8); expect(doc.paragraphs[11].markFormat.characterSpacing).toBe(1.25);
  const result = layout(doc); expect(result.pageCount).toBeGreaterThan(1); expect(result.repeatedLines.some(l => l.fragments.some(f => f.text === 'Spaced header' && f.characterSpacing === 2))).toBe(true);
  expect(result.lines.find(l => l.marker).marker).toMatchObject({ characterSpacing: 1, fontSize: 12 }); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it.each([['21', 1.05], ['-9', -.45], ['+8', .4], ['0.5pt', .5], ['0.1pc', 1.2], ['0.1pi', 1.2], ['0.025in', 1.8], ['0.635mm', 1.8], ['0.0635cm', 1.8], ['-0pt', 0]])('reads twip and universal spacing %s and preserves untouched spellings', async (value, expected) => {
  const bytes = revise('word/document.xml', xml => spacingNode(xml).setAttributeNS(W, 'w:val', value)), pkg = await DocxPackage.open(bytes), doc = model(pkg); expect(run(doc, 'Expanded').characterSpacing).toBe(expected);
  select(doc, 'Condensed'); doc.setRunFormat({ bold: true }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Expanded').properties).toContain(`w:val="${value}"`);
});

it('edits direct/shared spacing, preserves zero overrides, round trips geometry and restores complete undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Expanded'); const initial = doc.snapshot(), before = layout(doc);
  doc.setRunFormat({ characterSpacing: 1.75 }); doc.editParagraphStyle('SpacingParagraph', { run: { characterSpacing: 3 } }); doc.editCharacterStyle('SpacingCharacter', { run: { characterSpacing: null } });
  expect(run(doc, 'Character condensed').characterSpacing).toBe(3); expect(run(doc, 'Explicit zero').characterSpacing).toBe(0); expect(run(doc, 'Expanded').fontSize).toBe(12);
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(formats(reopened)).toEqual(formats(doc)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc))); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); doc.redo(); doc.redo(); expect(formats(doc)).toEqual(formats(reopened));
});

it('inherits defaults and nearer table/paragraph/character declarations, and removes declarations back to inheritance', async () => {
  const bytes = revise('word/styles.xml', xml => spacingNode(xml).setAttributeNS(W, 'w:val', '10')), pkg = await DocxPackage.open(bytes), doc = model(pkg);
  expect(run(doc, 'Character spacing Á😀').characterSpacing).toBe(.5); expect(run(doc, 'Paragraph expanded').characterSpacing).toBe(1.25); expect(run(doc, 'Character condensed').characterSpacing).toBe(-.25); expect(run(doc, 'Spaced header').characterSpacing).toBe(2);
  doc.editParagraphStyle('SpacingChild', { run: { characterSpacing: null } }); expect(run(doc, 'Child reset').characterSpacing).toBe(1.25); doc.editParagraphStyle('SpacingParagraph', { run: { characterSpacing: null } }); expect(run(doc, 'Child reset').characterSpacing).toBe(.5);
  select(doc, 'Character spacing Á😀'); doc.setRunFormat({ characterSpacing: 0 }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc)); expect(run(reopened, 'Character spacing Á😀').properties).toContain('<w:spacing w:val="0"');
});

it('uses the same Canvas state for measuring and painting and keeps script spacing an absolute distance', () => {
  const context = { font: '', fontKerning: 'auto', letterSpacing: '0px' };
  for (const verticalAlign of ['baseline', 'superscript', 'subscript']) {
    const s = { fontSize: 16, verticalAlign, characterSpacing: 1.5 }, plain = measureTextGeometry('Á😀', { ...s, characterSpacing: 0 }, measure), spaced = measureTextGeometry('Á😀', s, measure);
    expect(spaced.width - plain.width).toBeCloseTo(4); expect(spaced.ascent).toBe(plain.ascent); expect(spaced.descent).toBe(plain.descent);
    setCanvasTextStyle(context, s); expect(parseFloat(context.letterSpacing)).toBeCloseTo(2 / (verticalAlign === 'baseline' ? 1 : .65)); expect(context.font).toContain('21.333333333333332px');
  }
  setCanvasTextStyle(context, { characterSpacing: 0 }); expect(context.letterSpacing).toBe('0px');
  expect(() => setCanvasTextStyle({ font: '', fontKerning: 'auto' }, { characterSpacing: 1 })).toThrow(/browser/); expect(() => setCanvasTextStyle({ font: '', fontKerning: 'auto' }, { characterSpacing: 0 })).not.toThrow();
});

it('reshapes at spacing boundaries, preserves shared color shaping and aligns carets, highlights and underlines to advances', () => {
  const doc = new TextDocument([paragraph('AVAV Á😀')]); doc.select(0, doc.text.length); doc.setRunFormat({ characterSpacing: 2, underline: true, highlight: 'yellow' }); const before = layout(doc);
  doc.select(1, 3); doc.setRunFormat({ color: 'FF0000' }); const after = layout(doc); expect(geometry(after)).toEqual(geometry(before)); expect(after.lines[0].fragments).toHaveLength(1);
  const line = after.lines[0], f = line.fragments[0]; expect(line.backgrounds[0].width).toBeCloseTo(f.width); expect(line.underlines[0].width + line.underlines[1].width + line.underlines[2].width).toBeCloseTo(f.width);
  const at = 7, caret = caretRect(after, at); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at); expect(selectionRects(after, 0, doc.text.length)[0].width).toBeCloseTo(f.width);
  doc.select(0, 2); doc.setRunFormat({ characterSpacing: -.5 }); expect(layout(doc).lines[0].fragments).toHaveLength(2);
});

it('recomputes AutoFit widths, wrapping and pagination while retaining repeated-header source selections', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc), at = doc.text.indexOf('Spaced header'); doc.select(at, doc.text.length); const range = doc.range; doc.setRunFormat({ characterSpacing: 5 }); const after = layout(doc);
  expect(after.pageCount).toBeGreaterThan(before.pageCount); expect(after.cells.map(c => c.width)).not.toEqual(before.cells.map(c => c.width)); expect(doc.range).toEqual(range);
  const copy = after.repeatedLines.find(l => l.start === at), caret = caretRect(after, at + 2, 'forward', copy.page); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 2); expect(selectionRects(after, at, at + 2).some(r => r.page === copy.page)).toBe(true); doc.undo(); expect(layout(doc)).toEqual(before);
});

it('preserves tab anchors and exact-height clipping, while spaced fields use their measured advances', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc), tab = result.lines.find(l => l.fragments.some(f => f.text === 'Aligned'));
  const field = tab.fragments.find(f => f.text === 'Field'); expect(field.width).toBeCloseTo(measure('Field', field).width); expect(tab.underlines.some(u => u.x + u.width > field.x)).toBe(true);
  const exact = result.lines.find(l => l.fragments.some(f => f.text === 'Exact spaced')), caret = caretRect(result, exact.start + 1); expect(exact.clip).toBe(true); expect(caret.y).toBeGreaterThanOrEqual(exact.y); expect(caret.y + caret.height).toBeLessThanOrEqual(exact.y + exact.height + 1e-6);
});

it('carries spacing through Unicode typing, empty marks, split/merge, mixed selections and undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); doc.select(doc.paragraphOffset(11)); const initial = doc.snapshot(); doc.replace('Á😀'); doc.insertParagraph(); doc.replace('Following'); expect(run(doc, 'Á😀').characterSpacing).toBe(1.25); expect(run(doc, 'Following').characterSpacing).toBe(1.25);
  const at = doc.text.indexOf('Following'); doc.select(at - 1, at); doc.replace(''); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc)); doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  doc.select(0); doc.setRunFormat({ characterSpacing: -.5 }); doc.replace('Pending '); expect(run(doc, 'Pending ').characterSpacing).toBe(-.5); doc.select(0, doc.text.indexOf('\n')); expect(doc.runFormatting.characterSpacing).toBeNull();
});

it.each(['', 'abc', '2.5', '0.025pt', '31681', '-31681', '1e2', '+1pt'])('rejects malformed or unsupported active spacing %s', async value => {
  await expect(DocxPackage.open(revise('word/document.xml', xml => spacingNode(xml).setAttributeNS(W, 'w:val', value)))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
it('rejects duplicate/nested spacing and active fitText even if direct spacing is zero', async () => {
  for (const change of [n => n.removeAttributeNS(W, 'val'), n => n.after(n.cloneNode(true)), n => n.append(node(n.ownerDocument, 'b', '1')), n => n.setAttributeNS(W, 'w:extra', '1'), n => { n.setAttributeNS(W, 'w:val', '0'); n.after(node(n.ownerDocument, 'fitText', '100')); }]) await expect(DocxPackage.open(revise('word/document.xml', xml => change(spacingNode(xml))))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const bytes = revise('word/styles.xml', xml => { const s = xml.createElementNS(W, 'w:style'); s.setAttributeNS(W, 'w:type', 'character'); s.setAttributeNS(W, 'w:styleId', 'FitTextStyle'); s.append(node(xml, 'name', 'Fitted text')); const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'fitText', '100')); s.append(r); xml.documentElement.append(s); });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); select(doc, 'Expanded'); const initial = doc.snapshot(); expect(() => doc.setCharacterStyle('FitTextStyle')).toThrow(/fitText/); expect(doc.snapshot()).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('accepts condensation and oversized graphemes but rejects reversed advances', () => {
  const doc = new TextDocument([paragraph('iiii')]); doc.select(0, 4); doc.setRunFormat({ characterSpacing: -.5 }); expect(layout(doc).lines).toHaveLength(1);
  doc.setRunFormat({ characterSpacing: -20 }); expect(() => layout(doc)).toThrow(/backwards/); doc.setRunFormat({ characterSpacing: 1584 }); expect(layout(doc).lines).toHaveLength(4);
});

it('rejects invalid spacing atomically and retains valid spacing on pictures without changing their advance', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx')), doc = model(pkg), at = doc.text.indexOf('\uFFFC'); doc.select(at, at + 1); const initial = doc.snapshot();
  for (const characterSpacing of [true, null, '4', Infinity, NaN, .025, 1584.05]) expect(() => doc.setRunFormat({ characterSpacing })).toThrow(); expect(doc.snapshot()).toEqual(initial);
  const before=geometry(layout(doc));
  for (const characterSpacing of [1,-1,50,-50]) { doc.setRunFormat({characterSpacing}); expect(geometry(layout(doc))).toEqual(before); const reopened=model(await DocxPackage.open(await save(pkg,doc))); expect(geometry(layout(reopened))).toEqual(before); expect(reopened.paragraphs.flatMap(p=>p.runs).find(r=>r.image).characterSpacing).toBe(characterSpacing); doc.undo(); expect(doc.snapshot()).toEqual(initial); }
  const p=doc.paragraphs.find(p=>p.runs.some(r=>r.image)); doc.editParagraphStyle(p.styleId || 'Normal',{run:{characterSpacing:1}}); expect(doc.paragraphs.flatMap(p=>p.runs).find(r=>r.image).characterSpacing).toBe(1); doc.undo();
  doc.select(0); doc.setRunFormat({characterSpacing:1}); const image=p.runs.find(r=>r.image).image; doc.insertImage(image.assetId,{width:image.width,height:image.height}); expect(doc.paragraphs[0].runs.find(r=>r.image).characterSpacing).toBe(1);
});

it('retains spaced marks on fresh numbering symbols through save/reopen', async () => {
  const pkg = createDocx([paragraph('')]), doc = model(pkg); doc.setRunFormat({ characterSpacing: 1.5 }); doc.replace('List item'); doc.toggleList('number'); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(layout(reopened).lines[0].marker.characterSpacing).toBe(1.5); expect(formats(reopened)).toEqual(formats(doc));
});

it('allows a nearer declaration to mask an unsupported inherited spacing and rejects exposing it atomically', async () => {
  const bytes = revise('word/styles.xml', xml => {
    const s = xml.createElementNS(W, 'w:style'); s.setAttributeNS(W, 'w:type', 'character'); s.setAttributeNS(W, 'w:styleId', 'WideAncestor'); s.append(node(xml, 'name', 'Wide ancestor'));
    const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'spacing', '31681')); s.append(r); xml.documentElement.append(s);
    namedStyle(xml, 'SpacingCharacter').insertBefore(node(xml, 'basedOn', 'WideAncestor'), namedStyle(xml, 'SpacingCharacter').lastChild);
  });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); expect(run(doc, 'Character condensed').characterSpacing).toBe(-.25); const before = doc.snapshot();
  expect(() => doc.editCharacterStyle('SpacingCharacter', { run: { characterSpacing: null } })).toThrow(/spacing/); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('retains imported spacing on inline pictures through export', async () => {
  const bytes = revise('word/document.xml', xml => {
    const r = xml.getElementsByTagNameNS(W, 'drawing')[0].parentNode; let properties = [...r.children].find(n => n.localName === 'rPr');
    if (!properties) { properties = xml.createElementNS(W, 'w:rPr'); r.prepend(properties); } properties.append(node(xml, 'spacing', '20'));
  }, readFileSync('public/fixtures/inline-images.docx'));
  const pkg=await DocxPackage.open(bytes),doc=model(pkg);expect(doc.paragraphs.flatMap(p=>p.runs).find(r=>r.image).characterSpacing).toBe(1);sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
});

it('rejects a condensed numbering label with a backwards interior advance even when its full width is positive', async () => {
  const bytes = revise('word/numbering.xml', xml => spacingNode(xml).setAttributeNS(W, 'w:val', '-10')), doc = model(await DocxPackage.open(bytes));
  const uneven = (text, style) => ({ ...measure(text, style), ...(style.characterSpacing === -.5 && ['1', '1.'].includes(text) ? { width: text === '1' ? 20 : 19 } : {}) });
  expect(() => layoutDocument(doc.paragraphs, uneven, pageGeometry(doc.pageSettings), doc.numbering, doc.tables)).toThrow(/backwards/);
});
