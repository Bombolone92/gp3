import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, selectionRects, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { HIGHLIGHTS, runBackground } from '../src/engine/backgrounds.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/text-highlights.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ width: ([...text].length - (text.match(/AV/g)?.length || 0) / 3) * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3, underlineOffset: 2, underlineThickness: 1 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
function equalParts(actual, expected, except = []) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
const revise = (path, from, to) => { const parts = unzipSync(source); expect(strFromU8(parts[path])).toContain(from); parts[path] = strToU8(strFromU8(parts[path]).replace(from, to)); return zipSync(parts); };

it('imports the full named palette, flat/themed shading and explicit none, with byte-exact no-edit export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const key of Object.keys(HIGHLIGHTS).filter(k => k !== 'none')) expect(run(doc, key + ' ').highlight).toBe(key);
  expect(run(doc, 'Shaded then highlighted')).toMatchObject({ highlight: 'yellow', shading: 'DDEEFF' });
  expect(runBackground(run(doc, 'Shaded then highlighted'))).toBe('#FFFF00'); expect(run(doc, 'Inherited shading').shading).toBe('DDEEFF');
  expect(run(doc, 'Character shading')).toMatchObject({ highlight: 'none', shading: 'C2D69B' }); expect(run(doc, 'Solid foreground').shading).toBe('445566');
  expect(doc.paragraphs.find(p => !p.runs.length).markFormat.highlight).toBe('magenta');
  const rendered = layout(doc); expect(rendered.lines.find(l => l.marker).marker.highlight).toBe('yellow'); expect(rendered.repeatedLines.flatMap(l => l.backgrounds).some(b => b.highlight === 'yellow')).toBe(true);
  const image = rendered.lines.flatMap(l => l.fragments).find(f => f.image), line = rendered.lines.find(l => l.fragments.includes(image)); const imageBackground = line.backgrounds.find(b => b.x === image.x && b.highlight === 'magenta'); expect(imageBackground.ascent).toBe(image.ascent); expect(imageBackground.width).toBeCloseTo(image.width, 8);
  equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits and removes direct highlights, reveals inherited shading, preserves media/themes and restores complete undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Yellow '); const initial = doc.snapshot();
  doc.setRunFormat({ highlight: 'cyan' }); select(doc, 'Shaded then highlighted'); doc.setRunFormat({ highlight: 'none' }); expect(runBackground(run(doc, 'Shaded then highlighted'))).toBe('#DDEEFF');
  select(doc, 'Highlighted header'); doc.setRunFormat({ highlight: 'magenta' });
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(run(reopened, 'Yellow ').highlight).toBe('cyan'); expect(run(reopened, 'Shaded then highlighted').properties).toContain('w:val="none"'); expect(run(reopened, 'Highlighted header').highlight).toBe('magenta'); equalParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(run(doc, 'Highlighted header').highlight).toBe('magenta');
});

it('keeps direct highlight through style changes and recomputes inherited shading under explicit removal', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.editParagraphStyle('CanvasShadeBase', { run: { shading: '112233' } }); expect(runBackground(run(doc, 'Shaded then highlighted'))).toBe('#FFFF00'); expect(run(doc, 'Inherited shading').shading).toBe('112233');
  select(doc, 'Shaded then highlighted'); doc.setRunFormat({ highlight: 'none' }); expect(runBackground(run(doc, 'Shaded then highlighted'))).toBe('#112233');
  doc.editParagraphStyle('CanvasShadeBase', { run: { shading: null } }); expect(run(doc, 'Inherited shading').shading).toBe('auto');
  doc.editCharacterStyle('CanvasShadeAccent', { run: { shading: 'foreground' } }); expect(runBackground(run(doc, 'Character shading'))).toBe('#000000');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Character shading').shading).toBe('foreground'); expect(run(reopened, 'Inherited shading').shading).toBe('auto');
  expect(() => doc.editParagraphStyle('CanvasShadeBase', { run: { highlight: 'yellow' } })).toThrow(/directly/); expect(() => doc.editCharacterStyle('CanvasShadeAccent', { run: { highlight: 'none' } })).toThrow(/directly/);
});

it('preserves shaping, pagination, caret and selection while painting tab gaps and exact-line backgrounds', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), before = layout(doc);
  const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.baseline, l.stops, ...l.fragments.map(f => [f.text, f.x, f.width])]) });
  const tab = before.lines.find(l => l.fragments.some(f => f.text === 'A')), gap = tab.backgrounds.find(b => b.width > 100 && b.highlight === 'yellow'); expect(gap).toBeDefined();
  const exact = before.lines.find(l => l.fragments.some(f => f.text === 'Exact line clipped')); expect(exact.clip).toBe(true); expect(exact.backgrounds[0].ascent + exact.backgrounds[0].descent).toBeGreaterThan(exact.height);
  doc.select(1, doc.text.length - 2); doc.setRunFormat({ highlight: 'darkBlue' }); const after = layout(doc); expect(geometry(after)).toEqual(geometry(before));
  const offset = doc.text.indexOf('Á😀'); expect(caretRect(after, offset)).toEqual(caretRect(before, offset)); expect(selectionRects(after, offset, offset + 4)).toEqual(selectionRects(before, offset, offset + 4));
  const rect = caretRect(before, offset); expect(hitTest(after, rect.page, rect.x, rect.y + rect.height / 2)).toEqual(hitTest(before, rect.page, rect.x, rect.y + rect.height / 2));
  const pair = new TextDocument([paragraph('AVAV')]), plain = layout(pair); pair.select(1, 3); pair.setRunFormat({ highlight: 'yellow' }); const colored = layout(pair); expect(geometry(colored)).toEqual(geometry(plain)); expect(colored.lines[0].fragments).toHaveLength(1);
  expect(colored.lines[0].fragments[0].colors.map(s => s.highlight)).toEqual(['none', 'yellow', 'none']);
});

it('supports Unicode future typing, empty paragraph marks, split/merge undo and mixed highlight selections', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Yellow '); doc.select(doc.range[1]); doc.setRunFormat({ highlight: 'green' }); doc.replace('Á😀'); expect(run(doc, 'Á😀').highlight).toBe('green');
  doc.insertParagraph(); doc.replace('New highlight'); expect(run(doc, 'New highlight').highlight).toBe('green'); doc.undo(); doc.undo(); doc.undo();
  select(doc, 'Yellow plain '); expect(doc.runFormatting.highlight).toBeNull();
  const empty = doc.paragraphs.findIndex(p => !p.runs.length), at = doc.paragraphOffset(empty); doc.select(at); expect(doc.runFormatting.highlight).toBe('magenta'); doc.replace('From mark'); expect(run(doc, 'From mark').highlight).toBe('magenta');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'From mark').highlight).toBe('magenta');
});

it.each(['', 'w:val="auto"', 'w:val="Yellow"', 'w:val="FFFF00"', 'w:val="yellow" w:color="FF0000"'])('rejects malformed active highlights: %s', async attrs => {
  await expect(DocxPackage.open(revise('word/document.xml', '<w:highlight w:val="yellow"/>', `<w:highlight ${attrs}/>`))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('rejects duplicate/nested highlights and unsupported shading even when hidden behind a highlight', async () => {
  for (const value of ['<w:highlight w:val="yellow"/><w:highlight w:val="none"/>', '<w:highlight w:val="yellow"><w:b/></w:highlight>', '<w:highlight w:val="yellow"/><w:shd w:val="pct20" w:fill="112233"/>', '<w:highlight w:val="yellow"/><w:shd w:val="nil"/>']) await expect(DocxPackage.open(revise('word/document.xml', '<w:highlight w:val="yellow"/>', value))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('rejects active default/style/numbering highlights according to the published implementation notes and keeps unused declarations', async () => {
  await expect(DocxPackage.open(revise('word/styles.xml', '<w:shd w:val="clear" w:fill="auto"/>', '<w:shd w:val="clear" w:fill="auto"/><w:highlight w:val="yellow"/>'))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  await expect(DocxPackage.open(revise('word/styles.xml', '<w:shd w:val="clear" w:fill="DDEEFF"/>', '<w:shd w:val="clear" w:fill="DDEEFF"/><w:highlight w:val="yellow"/>'))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const unused = await DocxPackage.open(revise('word/styles.xml', '</w:styles>', '<w:style w:type="character" w:styleId="UnusedHighlight"><w:name w:val="Unused highlight"/><w:rPr><w:highlight w:val="yellow"/></w:rPr></w:style></w:styles>'));
  const doc = model(unused); expect(() => { select(doc, 'Yellow '); doc.setCharacterStyle('UnusedHighlight'); }).toThrow(/highlight/); select(doc, 'Yellow '); doc.setRunFormat({ highlight: 'green' }); equalParts(unzipSync(await save(unused, doc)), unused.parts, ['word/document.xml']);
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/numbering.xml']), 'application/xml'), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const instance = [...xml.getElementsByTagNameNS(W, 'num')].find(n => n.getAttributeNS(W, 'numId') === '7'), id = instance.getElementsByTagNameNS(W, 'abstractNumId')[0].getAttributeNS(W, 'val');
  const abstract = [...xml.getElementsByTagNameNS(W, 'abstractNum')].find(n => n.getAttributeNS(W, 'abstractNumId') === id), rpr = xml.createElementNS(W, 'w:rPr'), h = xml.createElementNS(W, 'w:highlight'); h.setAttributeNS(W, 'w:val', 'yellow'); rpr.append(h); abstract.getElementsByTagNameNS(W, 'lvl')[0].append(rpr); parts['word/numbering.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('validates the exact palette and edits atomically, including clear/solid automatic shading', async () => {
  expect(HIGHLIGHTS).toMatchObject({ darkBlue: '00008B', darkCyan: '008B8B', darkGreen: '006400', darkRed: '8B0000', darkGray: 'A9A9A9', lightGray: 'D3D3D3' }); expect(Object.keys(HIGHLIGHTS)).toHaveLength(17);
  const pkg = createDocx([paragraph('Fresh')]), doc = model(pkg); select(doc, 'Fresh'); const initial = doc.snapshot();
  for (const value of [true, null, 'auto', '#FFFF00', 'Yellow', '__proto__']) expect(() => doc.setRunFormat({ highlight: value })).toThrow(); expect(doc.snapshot()).toEqual(initial);
  doc.setRunFormat({ highlight: 'black', shading: '112233' }); expect(runBackground(run(doc, 'Fresh'))).toBe('#000000'); doc.setRunFormat({ highlight: 'none' }); expect(runBackground(run(doc, 'Fresh'))).toBe('#112233');
  doc.setRunFormat({ shading: 'foreground' }); expect(runBackground(run(doc, 'Fresh'), '#000000')).toBe('#FFFFFF');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Fresh')).toMatchObject({ highlight: 'none', shading: 'foreground' });
});

it('resolves shading through nonautomatic document and table defaults while closer declarations take precedence', async () => {
  const parts = unzipSync(source), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
  xml.getElementsByTagNameNS(W, 'docDefaults')[0].getElementsByTagNameNS(W, 'shd')[0].setAttributeNS(W, 'w:fill', 'AABBCC');
  const table = [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === 'TableGrid'), rpr = xml.createElementNS(W, 'w:rPr'), shade = xml.createElementNS(W, 'w:shd'); shade.setAttributeNS(W, 'w:val', 'clear'); shade.setAttributeNS(W, 'w:fill', '225588'); rpr.append(shade); table.insertBefore(rpr, table.getElementsByTagNameNS(W, 'tblPr')[0]);
  parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  for (const [text, shading] of [['Highlights Á😀', 'AABBCC'], ['Beside body', '225588'], ['Shaded header', 'DDEEFF'], ['Inherited shading', 'DDEEFF'], ['Character shading', 'C2D69B'], ['Solid foreground', '445566']]) expect(run(doc, text).shading, text).toBe(shading);
  select(doc, 'Beside body'); doc.setRunFormat({ shading: 'auto', highlight: 'none' }); expect(runBackground(run(doc, 'Beside body'), '#EEEEEE')).toBe('#EEEEEE');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(run(reopened, 'Beside body').shading).toBe('auto');
});
