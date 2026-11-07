import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { scriptGeometry } from '../src/engine/vertical-align.js';
import { measureTextGeometry } from '../src/engine/text-geometry.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/script-text.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ ...fontMetrics(style), width: ([...text].length - (text.match(/AV/g)?.length || 0) / 3) * style.fontSize * 2 / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const p = (doc, text) => doc.paragraphs.find(p => paragraphText(p) === text);
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
const formats = doc => doc.paragraphs.map(p => [p.markFormat.verticalAlign, p.runs.map(r => [r.text, r.verticalAlign, r.fontSize])]);
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
const style = (xml, id) => [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === id);

it('keeps fallback size and vertical metrics without inventing an italic horizontal shift', () => {
  for (const italic of [false, true]) {
    const data = readFileSync(`public/fonts/NotoSans${italic ? '-Italic' : ''}.ttf`), tables = {};
    for (let i = 0; i < data.readUInt16BE(4); i++) { const at = 12 + i * 16; tables[data.toString('ascii', at, at + 4)] = data.readUInt32BE(at + 8); }
    const units = data.readUInt16BE(tables.head + 18);
    for (const fontSize of [12, 13.5, 32]) for (const verticalAlign of ['superscript', 'subscript']) {
      const s = { fontSize, italic, verticalAlign }, g = scriptGeometry(s), at = tables['OS/2'] + (verticalAlign === 'subscript' ? 10 : 18), scale = fontSize * 4 / 3 / units;
      expect(g.scaleX).toBe(data.readInt16BE(at) / units); expect(g.scaleY).toBe(data.readInt16BE(at + 2) / units);
      expect(g.offsetX).toBe(0); expect(g.offsetY).toBeCloseTo(data.readInt16BE(at + 6) * scale * (verticalAlign === 'subscript' ? 1 : -1));
      const raw = measure('AV', s), m = measureTextGeometry('AV', s, measure);
      expect(m.width).toBeCloseTo(raw.width * g.scaleX); expect(m.ascent + m.descent).toBeCloseTo((raw.ascent + raw.descent) * g.scaleY);
      expect(m.underlineOffset).toBeCloseTo(raw.underlineOffset * g.scaleY + g.offsetY); expect(s.fontSize).toBe(fontSize);
      expect(Number.isFinite(measureTextGeometry('A', s, () => ({ width: 10, ascent: 10, descent: 3 })).underlineOffset)).toBe(true);
    }
  }
});

it('imports direct, inherited, baseline, empty-mark and numbering scripts with exact no-edit preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, value] of [['Script text Á😀', 'baseline'], ['Raised direct', 'superscript'], ['Lowered direct', 'subscript'], ['Paragraph raised', 'superscript'], ['Character lowered', 'subscript'], ['Explicit baseline', 'baseline'], ['Child baseline', 'baseline'], ['Styled character', 'subscript'], ['Repeated script header', 'superscript'], ['Header baseline', 'baseline'], ['Table inherited', 'superscript']]) expect(run(doc, text).verticalAlign, text).toBe(value);
  expect(doc.paragraphs[9].markFormat).toMatchObject({ verticalAlign: 'superscript', fontSize: 20 });
  const result = layout(doc); expect(result.pageCount).toBeGreaterThan(1); expect(result.repeatedLines.some(l => l.fragments.some(f => f.text === 'Repeated script header' && f.textTransform))).toBe(true);
  expect(result.lines.find(l => l.marker).marker).toMatchObject({ verticalAlign: 'superscript', fontSize: 12, textTransform: { scaleX: .65, scaleY: .6 } });
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits direct and shared positions, preserves direct baseline, round trips geometry and fully undoes', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Raised direct'); const initial = doc.snapshot(), before = layout(doc);
  doc.setRunFormat({ verticalAlign: 'subscript' }); expect(run(doc, 'Raised direct').fontSize).toBe(16);
  doc.editParagraphStyle('ScriptParagraph', { run: { verticalAlign: 'subscript' } }); doc.editCharacterStyle('ScriptCharacter', { run: { verticalAlign: 'baseline' } });
  expect(run(doc, 'Explicit baseline').verticalAlign).toBe('baseline'); expect(run(doc, 'Character lowered').verticalAlign).toBe('baseline');
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(formats(reopened)).toEqual(formats(doc)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc)));
  sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(formats(doc)).toEqual(formats(reopened));
});

it('removes style declarations back to inheritance and treats character alignment as an absolute enum', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.editParagraphStyle('ScriptChild', { run: { verticalAlign: null } }); expect(run(doc, 'Child baseline').verticalAlign).toBe('superscript');
  doc.editCharacterStyle('ScriptCharacter', { run: { verticalAlign: 'superscript' } }); expect(run(doc, 'Character lowered').verticalAlign).toBe('superscript');
  doc.editCharacterStyle('ScriptCharacter', { run: { verticalAlign: null } }); expect(run(doc, 'Character lowered').verticalAlign).toBe('superscript'); expect(run(doc, 'Styled character').verticalAlign).toBe('baseline');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc)); expect(reopened.styles.definitions.ScriptChild.run.verticalAlign).toBeUndefined();
});

it('inherits a nonbaseline document default while closer table, paragraph, character and direct values win', async () => {
  const bytes = revise('word/styles.xml', xml => xml.getElementsByTagNameNS(W, 'docDefaults')[0].getElementsByTagNameNS(W, 'vertAlign')[0].setAttributeNS(W, 'w:val', 'subscript'));
  const pkg = await DocxPackage.open(bytes), doc = model(pkg);
  for (const [text, value] of [['Script text Á😀', 'subscript'], ['Paragraph raised', 'superscript'], ['Character lowered', 'subscript'], ['Explicit baseline', 'baseline'], ['Table inherited', 'superscript'], ['Header baseline', 'baseline']]) expect(run(doc, text).verticalAlign, text).toBe(value);
  select(doc, 'Script text Á😀'); doc.setRunFormat({ verticalAlign: 'baseline' }); const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Script text Á😀').verticalAlign).toBe('baseline');
});

it('keeps script color spans shaped together but separates baseline transitions, with shifted decorations and caret hit tests', async () => {
  const doc = new TextDocument([paragraph('AVAV')]); doc.select(0, 4); doc.setRunFormat({ verticalAlign: 'superscript', underline: true, highlight: 'yellow' }); const before = layout(doc);
  doc.select(1, 3); doc.setRunFormat({ color: 'FF0000' }); const after = layout(doc); expect(geometry(after)).toEqual(geometry(before)); expect(after.lines[0].fragments).toHaveLength(1);
  const f = after.lines[0].fragments[0], line = after.lines[0]; expect(f.colors).toHaveLength(3); expect(f.width).toBeCloseTo(measure('AVAV', f).width * .65);
  expect(line.backgrounds[0]).toMatchObject({ ascent: f.ascent, descent: f.descent }); expect(line.underlines[0].offset).toBeLessThan(0);
  const caret = caretRect(after, 2); expect(caret.height).toBeCloseTo((fontMetrics(f).ascent + fontMetrics(f).descent) * .6); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(2);
  expect(selectionRects(after, 1, 3)[0].height).toBe(line.height);
  doc.select(2, 4); doc.setRunFormat({ verticalAlign: 'baseline' }); expect(layout(doc).lines[0].fragments).toHaveLength(2); expect(new Set(layout(doc).lines[0].underlines.map(u => u.offset)).size).toBe(2);
});

it('shifts tab backgrounds and underlines, and retains a visible caret when exact spacing clips raised text completely', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc);
  const tab = result.lines.find(l => l.fragments.some(f => f.text === 'Tab')), gap = tab.backgrounds.find(b => b.width > 20); expect(gap).toBeDefined();
  const m = measureTextGeometry('', run(doc, 'Tab\tTail'), measure); expect(gap).toMatchObject({ ascent: m.ascent, descent: m.descent }); expect(tab.underlines.every(u => u.offset === m.underlineOffset)).toBe(true);
  const exact = result.lines.find(l => l.fragments.some(f => f.text === 'Exact raised')), caret = caretRect(result, doc.text.indexOf('Exact raised') + 1);
  expect(exact.clip).toBe(true); expect(exact.baseline + exact.fragments[0].descent).toBeLessThan(exact.y); expect(caret.y).toBe(exact.y); expect(caret.height).toBe(1);
});

it('types Unicode from scripted empty marks and pending formatting through split/merge and undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), at = doc.paragraphOffset(9); doc.select(at); const initial = doc.snapshot();
  const empty = caretRect(layout(doc), at); expect(empty.height).toBeCloseTo((fontMetrics({ fontSize: 20 }).ascent + fontMetrics({ fontSize: 20 }).descent) * .6);
  doc.replace('Á😀'); doc.insertParagraph(); doc.replace('Following'); expect(run(doc, 'Á😀').verticalAlign).toBe('superscript'); expect(run(doc, 'Following').verticalAlign).toBe('superscript');
  const mergeAt = doc.text.indexOf('Following'); doc.select(mergeAt - 1, mergeAt); doc.replace(''); expect(p(doc, 'Á😀Following').runs.every(r => r.verticalAlign === 'superscript')).toBe(true);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(formats(reopened)).toEqual(formats(doc));
  doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  select(doc, 'Script text Á😀'); doc.select(doc.range[1]); doc.setRunFormat({ verticalAlign: 'subscript' }); doc.replace('New'); expect(run(doc, 'New').verticalAlign).toBe('subscript');
  doc.select(0, doc.text.indexOf('\n')); expect(doc.runFormatting.verticalAlign).toBeNull();
});

it('recomputes AutoFit and page breaks after formatting changes and retains repeated-header source selection', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc), at = doc.text.indexOf('Repeated script header');
  doc.select(0, doc.text.length); doc.setRunFormat({ verticalAlign: 'baseline' }); const after = layout(doc); expect(after.pageCount).toBeGreaterThan(before.pageCount);
  expect(after.cells.map(c => c.width)).not.toEqual(before.cells.map(c => c.width));
  const copy = after.repeatedLines.find(l => l.start === at), caret = caretRect(after, at + 2, 'forward', copy.page); expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 2);
  expect(doc.range).toEqual([0, doc.text.length]); doc.undo(); expect(layout(doc)).toEqual(before);
});

it.each(['', 'w:val="auto"', 'w:val="SuperScript"', 'w:val="superscript" w:foo="1"'])('rejects invalid active vertical alignment: %s', async attrs => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:vertAlign w:val="subscript"/>', `<w:vertAlign ${attrs}/>`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
it('rejects duplicate and nested alignment elements before editing', async () => {
  for (const content of ['<w:vertAlign w:val="superscript"/>', '<w:b/>']) {
    const bytes = revise('word/document.xml', xml => { const n = xml.getElementsByTagNameNS(W, 'vertAlign')[0]; const child = new DOMParser().parseFromString(`<w:rPr xmlns:w="${W}">${content}</w:rPr>`, 'application/xml').documentElement.firstChild; if (child.localName === 'vertAlign') n.after(xml.importNode(child, true)); else n.append(xml.importNode(child, true)); });
    await expect(DocxPackage.open(bytes)).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  }
});

it('rejects malformed positions while allowing manual shifts and an inherited shift reset by zero', async () => {
  for (const value of ['bad', '.5', '']) {
    const bytes = revise('word/document.xml', xml => xml.getElementsByTagNameNS(W, 'rPr')[0].append(node(xml, 'position', value)));
    await expect(DocxPackage.open(bytes)).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  }
  const shifted = revise('word/styles.xml', xml => style(xml, 'ScriptParagraph').getElementsByTagNameNS(W, 'rPr')[0].append(node(xml, 'position', '2')));
  expect(run(model(await DocxPackage.open(shifted)), 'Paragraph raised').baselineShift).toBe(1);
  const masked = revise('word/styles.xml', xml => { style(xml, 'ScriptParagraph').getElementsByTagNameNS(W, 'rPr')[0].append(node(xml, 'position', '0pt')); style(xml, 'ScriptParagraph').getElementsByTagNameNS(W, 'basedOn')[0].setAttributeNS(W, 'w:val', 'ShiftBase'); const s = node(xml, 'style', ''); s.removeAttributeNS(W, 'val'); s.setAttributeNS(W, 'w:type', 'paragraph'); s.setAttributeNS(W, 'w:styleId', 'ShiftBase'); s.append(node(xml, 'name', 'Shift base')); const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'position', '2')); s.append(r); xml.documentElement.append(s); });
  const pkg = await DocxPackage.open(masked), doc = model(pkg); select(doc, 'Paragraph raised'); doc.setRunFormat({ verticalAlign: 'subscript' }); await expect(DocxPackage.open(await save(pkg, doc))).resolves.toBeDefined();
});

it('preserves picture script formatting without transforming pictures and rejects invalid edits atomically', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/inline-images.docx')), doc = model(pkg), at = doc.text.indexOf('\uFFFC'); doc.select(at, at + 1); const initial = doc.snapshot();
  for (const verticalAlign of [true, null, 'auto']) expect(() => doc.setRunFormat({ verticalAlign })).toThrow(); expect(doc.snapshot()).toEqual(initial);
  const before = geometry(layout(doc));
  for (const verticalAlign of ['superscript', 'subscript']) {
    doc.setRunFormat({ verticalAlign }); expect(geometry(layout(doc))).toEqual(before);
    const reopened = model(await DocxPackage.open(await save(pkg, doc)));
    expect(reopened.paragraphs.flatMap(p => p.runs).find(r => r.image).verticalAlign).toBe(verticalAlign);
    expect(geometry(layout(reopened))).toEqual(before); doc.undo(); expect(doc.snapshot()).toEqual(initial);
  }
  const pictureP = doc.paragraphs.find(p => p.runs.some(r => r.image)); doc.editParagraphStyle(pictureP.styleId || 'Normal', { run: { verticalAlign: 'superscript' } });
  expect(doc.paragraphs.flatMap(p => p.runs).find(r => r.image).verticalAlign).toBe('superscript'); doc.undo();
  doc.select(0, 1); doc.createCharacterStyle('Raised character'); const id = doc.characterStyle; doc.editCharacterStyle(id, { run: { verticalAlign: 'superscript' } });
  doc.select(at, at + 1); doc.setCharacterStyle(id); expect(doc.paragraphs.flatMap(p => p.runs).find(r => r.image).verticalAlign).toBe('superscript'); doc.undo(); doc.undo(); doc.undo();
  const bytes = revise('word/document.xml', xml => { const drawing = xml.getElementsByTagNameNS(W, 'drawing')[0], r = drawing.parentNode; let rpr = [...r.children].find(n => n.localName === 'rPr'); if (!rpr) { rpr = xml.createElementNS(W, 'w:rPr'); r.prepend(rpr); } rpr.append(node(xml, 'vertAlign', 'superscript')); }, readFileSync('public/fixtures/inline-images.docx'));
  expect(geometry(layout(model(await DocxPackage.open(bytes))))).toEqual(before);
  doc.select(0); doc.setRunFormat({ verticalAlign: 'superscript' }); const image = pictureP.runs.find(r => r.image).image;
  doc.insertImage(image.assetId, { width: image.width, height: image.height });
  expect(doc.paragraphs[0].runs.find(r => r.image)).toMatchObject({ verticalAlign: 'superscript', image: { width: image.width, height: image.height } });
  doc.replace('Raised beside image'); expect(run(doc, 'Raised beside image').verticalAlign).toBe('superscript'); expect(layout(doc).lines.flatMap(l => l.fragments).filter(f => f.image).every(f => !f.textTransform)).toBe(true);
});

it('preserves unused unsupported script declarations but rejects their application without changing history', async () => {
  const bytes = revise('word/styles.xml', xml => { const s = xml.createElementNS(W, 'w:style'); s.setAttributeNS(W, 'w:type', 'character'); s.setAttributeNS(W, 'w:styleId', 'InvalidScript'); s.append(node(xml, 'name', 'Invalid script')); const r = xml.createElementNS(W, 'w:rPr'); r.append(node(xml, 'vertAlign', 'raise')); s.append(r); xml.documentElement.append(s); });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg); select(doc, 'Paragraph raised'); const initial = doc.snapshot();
  expect(() => doc.setCharacterStyle('InvalidScript')).toThrow(/baseline/); expect(doc.snapshot()).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('carries script formatting into a fresh list marker through the paragraph mark and round trips it', async () => {
  const pkg = createDocx([paragraph('Formula')]), doc = model(pkg); doc.select(0, doc.text.length); doc.setRunFormat({ verticalAlign: 'superscript' });
  // Include the paragraph mark through the explicit empty-paragraph typing path.
  doc.select(doc.text.length); doc.insertParagraph(); doc.setRunFormat({ verticalAlign: 'subscript' }); doc.replace('Second'); doc.toggleList('number');
  expect(layout(doc).lines.find(l => l.marker).marker).toMatchObject({ verticalAlign: 'subscript', textTransform: { scaleX: .65 } });
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(layout(reopened).lines.find(l => l.marker).marker.verticalAlign).toBe('subscript'); expect(formats(reopened)).toEqual(formats(doc));
});
