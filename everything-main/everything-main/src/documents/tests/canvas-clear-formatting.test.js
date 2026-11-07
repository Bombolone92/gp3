import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, runFormat } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/clear-text-formatting.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const fixture = async () => { const pkg = await DocxPackage.open(source); return [pkg, model(pkg)]; };
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const sameParts = (actual, expected, except = []) => { expect(Object.keys(actual)).toEqual(Object.keys(expected)); for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true); };
const xml = bytes => new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml');
const nodes = (doc, tag) => [...doc.getElementsByTagNameNS(W, tag)];
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const layout = doc => layoutDocument(doc.paragraphs, (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 }), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);

it('imports independently authored direct, opaque and style-only properties without changing package bytes', async () => {
  const [pkg, doc] = await fixture();
  expect(doc.paragraphs[1].runs[1]).toMatchObject({ fontSize: 24, bold: false, italic: false, hasDirectProperties: true });
  expect(doc.paragraphs[4].runs[0]).toMatchObject({ hasDirectProperties: true, directFormat: {} });
  expect(doc.paragraphs[5].runs[0].hasDirectProperties).toBe(false);
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('clears a backward partial selection at complete graphemes, retaining the character style and surrounding formatting', async () => {
  const [pkg, doc] = await fixture(), start = doc.text.indexOf('Á😀'); doc.select(start + 4, start + 1);
  const before = doc.snapshot(); expect(doc.range).toEqual([start + 2, start + 4]);
  expect(doc.clearDirectTextFormatting()).toBe(true); expect(doc.selection).toEqual(before.selection);
  const emoji = doc.paragraphs[1].runs.find(r => r.text === '😀');
  expect(emoji).toMatchObject({ styleId: 'ResetCharacterChild', fontSize: 14, bold: true, italic: true, underlineStyle: 'single', color: '224488', characterSpacing: 0, highlight: 'none' });
  expect(doc.paragraphs[1].runs.find(r => r.text.includes('reset Á'))).toMatchObject({ fontSize: 24, bold: false, italic: false });
  const out = model(await DocxPackage.open(await save(pkg, doc))); expect(out.paragraphs[1].runs.map(r => [r.text, runFormat(r), r.styleId])).toEqual(doc.paragraphs[1].runs.map(r => [r.text, runFormat(r), r.styleId]));
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); expect(doc.paragraphs[1].runs.find(r => r.text === '😀').bold).toBe(true);
});

it('clears all direct run and selected mark declarations in one undo step while preserving source structures and live inheritance', async () => {
  const [pkg, doc] = await fixture(); doc.select(doc.text.length, 0); const before = doc.snapshot(), bookmarks = doc.bookmarks.map(b => [b.name, b.start, b.end]), images = doc.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
  expect(doc.clearDirectTextFormatting()).toBe(true); expect(doc.history).toHaveLength(1); expect(doc.text).toBe(pkg.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'));
  expect(doc.selection).toEqual(before.selection); expect(doc.tables).toEqual(before.tables); expect(doc.bookmarks.map(b => [b.name, b.start, b.end])).toEqual(bookmarks);
  expect(doc.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image))).toEqual(images);
  const bytes = await save(pkg, doc); expectBodyEditParts(unzipSync(bytes), pkg.parts);
  for (const props of nodes(xml(bytes), 'rPr')) expect([...props.children].every(n => n.localName === 'rStyle')).toBe(true);
  const reopened = model(await DocxPackage.open(bytes)); expect(reopened.text).toBe(doc.text); expect(reopened.paragraphs[1].runs[1].styleId).toBe('ResetCharacterChild');
  reopened.editParagraphStyle('ResetBase', { run: { fontSize: 18 } }); reopened.editCharacterStyle('ResetCharacter', { run: { italic: null } });
  expect(reopened.paragraphs[1].runs[1]).toMatchObject({ fontSize: 18, italic: false, bold: true }); expect(reopened.paragraphs[3].markFormat).toMatchObject({ fontSize: 18, italic: false, bold: true });
  expect(reopened.paragraphs[6].runs[0].link.target).toBe('https://example.org/reset');
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); expect(doc.paragraphs[1].runs[1].fontSize).toBe(14);
});

it('clears selected paragraph marks and excludes a selection ending at the next paragraph start', async () => {
  const [, doc] = await fixture(), a = doc.paragraphOffset(1), b = doc.paragraphOffset(2), original = structuredClone(doc.paragraphs[2]);
  doc.select(a, b); doc.clearDirectTextFormatting(); expect(doc.paragraphs[1].markFormat.fontSize).toBe(14); expect(doc.paragraphs[2]).toEqual(original);
});

it('resets an empty paragraph mark and keeps its style on typing, splitting, save and reopen', async () => {
  const [pkg, doc] = await fixture(); doc.select(doc.paragraphOffset(3)); const before = doc.snapshot();
  expect(doc.clearDirectTextFormatting()).toBe(true); expect(doc.runFormatting).toMatchObject({ fontSize: 14, italic: true, bold: true });
  const out = model(await DocxPackage.open(await save(pkg, doc))); out.select(out.paragraphOffset(3)); out.replace('First'); out.insertParagraph(); out.replace('Second');
  const bytes = await save(pkg, out), reopened = model(await DocxPackage.open(bytes));
  for (const p of reopened.paragraphs.slice(3, 5)) { expect(p.markStyleId).toBe('ResetCharacterChild'); expect(p.runs[0]).toMatchObject({ fontSize: 14, italic: true, styleId: 'ResetCharacterChild' }); }
  for (const p of nodes(xml(bytes), 'p').slice(3, 5)) for (const props of nodes(p, 'rPr')) expect([...props.children].every(n => n.localName === 'rStyle')).toBe(true);
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('keeps a caret reset pending, removes opaque direct properties from future text and restores pending state with undo', async () => {
  const [pkg, doc] = await fixture(); doc.select(doc.text.indexOf('reset') + 2); const selection = { ...doc.selection };
  expect(doc.clearDirectTextFormatting()).toBe(false); expect(doc.history).toHaveLength(0); expect(doc.selection).toEqual(selection); expect(doc.runFormatting.fontSize).toBe(14);
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.replace('X'); const inserted = doc.paragraphs[1].runs.find(r => r.text === 'X');
  expect(inserted).toMatchObject({ fontSize: 14, italic: true, styleId: 'ResetCharacterChild' });
  const node = nodes(xml(await save(pkg, doc)), 'r').find(r => nodes(r, 't')[0]?.textContent === 'X'); expect(nodes(node, 'lang')).toHaveLength(0); expect(nodes(node, 'rFonts')).toHaveLength(0); expect(nodes(node, 'sz')).toHaveLength(0);
  doc.undo(); expect(doc.typingDirectCleared).toBe(true); expect(doc.runFormatting.fontSize).toBe(14); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.select(selection.focus); expect(doc.typingDirectCleared).toBe(false); expect(doc.runFormatting.fontSize).toBe(24);
});

it('combines a pending reset with a character-style choice and new direct formatting without reviving old declarations', async () => {
  const [pkg, doc] = await fixture(); doc.select(doc.text.indexOf('reset') + 2); doc.clearDirectTextFormatting(); doc.setCharacterStyle('Emphasis'); doc.setRunFormat({ underlineStyle: 'double' }); doc.replace('X');
  const run = doc.paragraphs[1].runs.find(r => r.text === 'X'); expect(run).toMatchObject({ fontSize: 14, italic: true, bold: true, underlineStyle: 'double', styleId: 'Emphasis' });
  const props = nodes(xml(await save(pkg, doc)), 'r').find(r => nodes(r, 't')[0]?.textContent === 'X'); expect(nodes(props, 'sz')).toHaveLength(0); expect(nodes(props, 'lang')).toHaveLength(0); expect(nodes(props, 'u')[0].getAttributeNS(W, 'val')).toBe('double');
});

it('gives the inserted break cleared formatting after a pending reset', async () => {
  const [pkg, doc] = await fixture(); doc.select(doc.text.indexOf('reset') + 2); doc.clearDirectTextFormatting(); doc.insertParagraph(); doc.replace('X');
  const bytes = await save(pkg, doc), p = nodes(xml(bytes), 'p')[1], mark = [...p.children].find(n => n.localName === 'pPr');
  expect(nodes(mark, 'lang')).toHaveLength(0); expect(nodes(mark, 'sz')).toHaveLength(0);
  expect(model(await DocxPackage.open(bytes)).paragraphs[1].markFormat.fontSize).toBe(14);
});

it('keeps cleared formatting after reopening and splitting a paragraph whose unselected mark still has direct formatting', async () => {
  const [pkg, doc] = await fixture(); select(doc, 'reset Á😀'); doc.clearDirectTextFormatting(); doc.setRunFormat({ highlight: 'yellow' });
  const out = await DocxPackage.open(await save(pkg, doc)), reopened = model(out); reopened.select(reopened.text.indexOf('reset') + 2); reopened.insertParagraph();
  expect(reopened.paragraphs[1].markFormat).toMatchObject({ fontSize: 14, highlight: 'yellow' });
  const again = model(await DocxPackage.open(await save(out, reopened))); expect(again.paragraphs[1].markFormat).toMatchObject({ fontSize: 14, highlight: 'yellow' });
});

it('takes a new paragraph mark from the active run, including opaque declarations, and retains empty-mark properties during typing', async () => {
  const [pkg, doc] = await fixture(); doc.select(doc.text.indexOf('reset') + 2); const before = doc.snapshot(), originalMark = structuredClone(doc.paragraphs[1].markFormat); doc.insertParagraph();
  expect(doc.paragraphs[2].markFormat).toEqual(originalMark);
  expect(doc.paragraphs[1].markFormat.fontSize).toBe(24);
  const bytes = await save(pkg, doc), p = nodes(xml(bytes), 'p')[1], mark = [...p.children].find(n => n.localName === 'pPr');
  expect(nodes(mark, 'lang')[0].getAttributeNS(W, 'val')).toBe('fr-CA'); expect(nodes(mark, 'rFonts')[0].getAttributeNS(W, 'ascii')).toBe('Courier New');
  expect(model(await DocxPackage.open(bytes)).paragraphs[1].markFormat.fontSize).toBe(24);
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.select(doc.paragraphOffset(3)); doc.replace('Empty'); doc.insertParagraph(); doc.replace('Next');
  const out = xml(await save(pkg, doc));
  for (const p of nodes(out, 'p').slice(3, 5)) {
    const languages = nodes(p, 'r').flatMap(r => nodes(r, 'lang')); expect(languages.length).toBeGreaterThan(0);
    expect(languages.every(n => n.getAttributeNS(W, 'val') === 'fr-CA')).toBe(true);
  }
  expect(model(await DocxPackage.open(await save(pkg, doc))).paragraphs[4].markFormat.fontSize).toBe(26);
});

it('retains redo for already inherited selections and repeated resets', async () => {
  const [, doc] = await fixture(); select(doc, 'reset Á😀'); doc.clearDirectTextFormatting(); doc.undo();
  select(doc, 'Style only'); const before = doc.snapshot(); expect(doc.clearDirectTextFormatting()).toBe(false); expect(doc.snapshot()).toEqual(before); expect(doc.future).toHaveLength(1);
  doc.redo(); select(doc, 'reset Á😀'); expect(doc.clearDirectTextFormatting()).toBe(false); expect(doc.history).toHaveLength(1);
});

it('removes direct language/proofing declarations and restores the inherited font language', async () => {
  const [pkg, doc] = await fixture(); select(doc, 'Language only'); const before = doc.runFormatting;
  expect(before.fontLanguage).toBe('fr-CA');
  expect(doc.clearDirectTextFormatting()).toBe(true); expect(doc.runFormatting).toEqual({ ...before, fontLanguage: 'en-US', noProof: false }); // noProof was only direct
  const p = nodes(xml(await save(pkg, doc)), 'p')[4]; expect(nodes(p, 'lang')).toHaveLength(0); expect(nodes(p, 'noProof')).toHaveLength(0);
});

it('removes declarations equal to the current style and keeps selected and pending text responsive to later style edits', async () => {
  const [pkg, doc] = await fixture(); select(doc, 'reset Á😀'); doc.setRunFormat({ fontSize: 14 }); doc.clearDirectTextFormatting();
  doc.editParagraphStyle('ResetBase', { run: { fontSize: 17 } }); expect(doc.runFormatting.fontSize).toBe(17);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); select(reopened, 'reset Á😀'); expect(reopened.runFormatting.fontSize).toBe(17);
  const [, pending] = await fixture(); pending.select(pending.text.indexOf('reset') + 2); pending.clearDirectTextFormatting(); pending.editParagraphStyle('ResetBase', { run: { fontSize: 19 } });
  expect(pending.runFormatting.fontSize).toBe(19); pending.replace('X'); expect(pending.paragraphs[1].runs.find(r => r.text === 'X').directFormat).toEqual({}); expect(pending.paragraphs[1].runs.find(r => r.text === 'X').fontSize).toBe(19);
});

it('repaginates flowing cells, retains zoom-independent caret and selection geometry, and restores full layout on undo', async () => {
  const [, doc] = await fixture(), before = layout(doc); doc.select(0, doc.text.length); doc.clearDirectTextFormatting(); const after = layout(doc);
  expect(after.pageCount).toBeLessThan(before.pageCount); expect(after.repeatedLines.length).toBeGreaterThan(0);
  const at = doc.text.indexOf('Á😀'), caret = caretRect(after, at); expect(hitTest(after, caret.page, caret.x, caret.y + 1)).toBe(at); expect(selectionRects(after, at, at + 4).length).toBeGreaterThan(0);
  const header = after.repeatedLines[0]; expect(hitTest(after, header.page, header.stops[0].x, header.y + header.height / 2)).toBe(header.start);
  doc.undo(); expect(layout(doc)).toEqual(before);
});

it('preflights every changed run before committing a reset that reveals unsupported inherited formatting', async () => {
  const [pkg] = await fixture(), styles = structuredClone(pkg.styles); Object.assign(styles.definitions.ResetBase.run, { capitalization: 'caps', characterSpacing: 1 });
  const doc = new TextDocument([paragraph('first', { runs: [{ text: 'first', fontSize: 24 }] }), paragraph('', { styleId: 'ResetBase', runs: [{ text: 'ß', styleManaged: true, directFormat: { capitalization: 'normal', characterSpacing: 0 } }] })], pkg.pageSettings, pkg.numbering, styles);
  doc.select(0, doc.text.length); const before = doc.snapshot(); expect(() => doc.clearDirectTextFormatting()).toThrow(/uppercase/); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(0);
  doc.select(doc.text.length); doc.clearDirectTextFormatting(); const pending = doc.snapshot(); expect(() => doc.replace('ß')).toThrow(/uppercase/); expect(doc.snapshot()).toEqual(pending);
});

it('rejects a reset that would expose unsupported image text scaling without changing assets or history', async () => {
  const [pkg] = await fixture(), styles = structuredClone(pkg.styles), paragraphs = structuredClone(pkg.paragraphs); styles.defaults.run.textScale = 80;
  const picture = paragraphs.flatMap(p => p.runs).find(r => r.image); picture.directFormat.textScale = 100;
  const doc = new TextDocument(paragraphs, pkg.pageSettings, pkg.numbering, styles, pkg.tables, pkg.assets); select(doc, '\ufffc'); const before = doc.snapshot();
  expect(() => doc.clearDirectTextFormatting()).toThrow(/pictures/); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(0);
});

it('resets original unstyled models to engine defaults without authoring frozen direct defaults', () => {
  const doc = new TextDocument([paragraph('', { runs: [{ text: 'bold', bold: true, fontSize: 22 }] })]); doc.select(0, 4); doc.clearDirectTextFormatting();
  expect(doc.runFormatting).toMatchObject({ bold: false, fontSize: 12 }); expect(doc.paragraphs[0].runs[0].overrides).toEqual({}); doc.undo(); expect(doc.runFormatting.bold).toBe(true);
});
