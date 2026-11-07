import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { styleRun, emptyStyles } from '../src/engine/styles.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = on => readFileSync(`public/fixtures/style-toggles-${on ? 'on' : 'off'}.docx`);
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const p = (doc, text) => doc.paragraphs.find(p => paragraphText(p) === text);
const flags = p => p.runs.map(r => [r.bold, r.italic]);
const allFlags = doc => doc.paragraphs.map(p => [p.markFormat.bold, p.markFormat.italic, flags(p)]);
const layout = doc => layoutDocument(doc.paragraphs, (text, style) => ({ ...fontMetrics(style), width: [...text].length * style.fontSize * (style.bold ? .82 : .55) }), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.baseline, l.stops, l.fragments.map(f => [f.text, f.x, f.width, f.bold, f.italic])]), cells: result.cells.map(c => [c.page, c.x, c.y, c.width, c.height]) });
function sameParts(actual, expected, except = []) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}

it.each([false, true])('imports style resets and character toggles with document defaults %s', async on => {
  const pkg = await DocxPackage.open(source(on)), doc = model(pkg);
  const expected = on ? [[true,true], [true,true], [false,false], [true,false], [true,true], [false,false], [false,false], [false,false], [true,true], [false,false]]
    : [[false,false], [true,true], [false,false], [true,false], [false,false], [true,true], [true,true], [true,true], [false,false], [false,false]];
  expect(doc.paragraphs.slice(0, 10).map(p => flags(p)[0])).toEqual(expected);
  for (const [text, result] of [['Repeated toggle header', [true,true]], ['Off header', [false,false]], ['Table only', [true,true]], ['Off in table', [false,false]], ['Child in table', [true,false]], ['Table off only', [false,false]], ['On in off table', [true,true]]]) expect(flags(p(doc, text)), text).toEqual([result]);
  expect(doc.paragraphs[10].markFormat).toMatchObject({ bold: on, italic: on });
  const laidOut = layout(doc); expect(laidOut.pageCount).toBeGreaterThan(1);
  expect(laidOut.repeatedLines.some(l => l.fragments.some(f => f.text === 'Repeated toggle header' && f.bold && f.italic))).toBe(true);
  expect(laidOut.lines.find(l => l.marker).marker).toMatchObject({ bold: true, italic: false });
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it.each([false, true])('edits shared declarations, retains direct overrides, repaginates and restores exact undo with defaults %s', async on => {
  const pkg = await DocxPackage.open(source(on)), doc = model(pkg); select(doc, 'On with character off');
  const initial = doc.snapshot(), before = layout(doc), selection = { ...doc.selection };
  doc.editParagraphStyle('ToggleOn', { run: { bold: false } });
  expect(flags(p(doc, 'Paragraph on'))).toEqual([[false,true]]); expect(flags(p(doc, 'Repeated toggle header'))).toEqual([[false,true]]);
  expect(flags(p(doc, 'Child in table'))).toEqual([[false,false]]); expect(flags(p(doc, 'Direct off'))).toEqual([[false,false]]);
  const after = layout(doc); expect(after.pageCount).toBeLessThan(before.pageCount); expect(doc.selection).toEqual(selection);
  const at = doc.text.indexOf('Unicode'), caret = caretRect(after, at);
  expect(hitTest(after, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at);
  expect(selectionRects(after, ...doc.range).length).toBeGreaterThan(0);
  expect(after.repeatedLines.every(l => l.fragments.every(f => !f.bold))).toBe(true);
  doc.editCharacterStyle('CharOff', { run: { italic: true } });
  expect(flags(p(doc, 'On with character off'))).toEqual([[on,on]]);
  select(doc, 'Direct off'); doc.setRunFormat({ bold: true });
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(allFlags(reopened)).toEqual(allFlags(doc)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc)));
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(initial); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(allFlags(doc)).toEqual(allFlags(reopened));
}, 30000);

it.each([false, true])('keeps nearest declarations and restores inheritance through removal with defaults %s', async on => {
  const pkg = await DocxPackage.open(source(on)), doc = model(pkg);
  doc.editParagraphStyle('ToggleChild', { run: { italic: null } }); expect(flags(p(doc, 'Nearest paragraph child'))).toEqual([[true,true]]);
  doc.editParagraphStyle('ToggleOn', { run: { bold: null } }); expect(flags(p(doc, 'Paragraph on'))).toEqual([[on,true]]);
  expect(flags(p(doc, 'Repeated toggle header'))).toEqual([[true,true]]); // Table declaration remains available.
  doc.editCharacterStyle('CharChild', { run: { bold: null } }); expect(flags(p(doc, 'Child with character child'))).toEqual([[true,on]]);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(allFlags(reopened)).toEqual(allFlags(doc));
  expect(reopened.styles.definitions.ToggleOn.run.bold).toBeUndefined(); expect(reopened.styles.definitions.ToggleChild.run.italic).toBeUndefined(); expect(reopened.styles.definitions.CharChild.run.bold).toBeUndefined();
});

it.each([false, true])('inherits empty marks and Unicode typing through split/merge with defaults %s', async on => {
  const pkg = await DocxPackage.open(source(on)), doc = model(pkg), at = doc.paragraphOffset(10); doc.select(at); const initial = doc.snapshot();
  expect(doc.runFormatting).toMatchObject({ bold: on, italic: on }); doc.replace('Typed Á😀'); doc.insertParagraph(); doc.replace('Following');
  expect(flags(p(doc, 'Typed Á😀'))).toEqual([[on,on]]); expect(flags(p(doc, 'Following'))).toEqual([[on,on]]);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(allFlags(reopened)).toEqual(allFlags(doc));
  doc.select(at + 'Typed Á😀'.length + 1); doc.delete(-1); expect(flags(p(doc, 'Typed Á😀Following'))).toEqual([[on,on]]);
  while (doc.undo()) { /* restore source and original mark selection */ }
  expect(doc.snapshot()).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('uses a default character declaration but leaves explicit unresolved references unformatted by that default', async () => {
  const pkg = await DocxPackage.open(source(true)), styles = structuredClone(pkg.styles); styles.defaultCharacter = 'CharOff';
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, styles, pkg.tables);
  expect(flags(p(doc, 'Default text'))).toEqual([[false,false]]);
  expect(styleRun(styles, 'Missing', { ...styles.defaults.run, bold: true }, 'character').bold).toBe(true);
  select(doc, 'Paragraph off'); doc.setCharacterStyle('CharOn'); expect(doc.runFormatting).toMatchObject({ bold: false, italic: false });
});

it.each(['cs', 'rtl'])('treats supported %s as an absolute boolean across paragraph and character styles', async tag => {
  const pkg = createDocx([paragraph('Script guard')]), parts = { ...pkg.parts };
  const styles = value => `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="P"><w:rPr><w:${tag}/></w:rPr></w:style><w:style w:type="character" w:styleId="C"><w:rPr><w:${tag} w:val="${value}"/></w:rPr></w:style></w:styles>`;
  parts['word/document.xml'] = strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="P"/><w:rPr><w:rStyle w:val="C"/></w:rPr></w:pPr><w:r><w:rPr><w:rStyle w:val="C"/></w:rPr><w:t>Script guard</w:t></w:r></w:p></w:body></w:document>`);
  parts['word/styles.xml'] = strToU8(styles('1'));
  const active = await DocxPackage.open(zipSync(parts));
  expect(active.paragraphs[0].runs[0]).toMatchObject({text:'Script guard',[tag]:true});
  expect(active.paragraphs[0].markFormat[tag]).toBe(true);
  parts['word/styles.xml'] = strToU8(styles('0')); const clear = await DocxPackage.open(zipSync(parts));
  expect(clear.paragraphs[0].runs[0]).toMatchObject({text:'Script guard',[tag]:false});
  expect(clear.paragraphs[0].markFormat[tag]).toBe(false);
});

it('applies the same toggle rule to hidden text while retaining ordinary non-toggle booleans', () => {
  const styles = emptyStyles(); styles.defaults.run.vanish = true;
  styles.definitions.C = { id: 'C', type: 'character', run: { vanish: false, cs: false, rtl: false, webHidden: false } };
  expect(styleRun(styles, 'C', { ...styles.defaults.run, cs: true, rtl: true, webHidden: true }, 'character')).toMatchObject({ vanish: false, cs: false, rtl: false, webHidden: false });
});
