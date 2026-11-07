import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { serializeFragment, bindUsedNamespaces } from '../src/engine/docx-compatibility.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/content-controls.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const controls = d => contentControlRanges(d.paragraphs);
const first = (x, tag) => x.getElementsByTagNameNS(W, tag)[0];
const open = async data => { const pkg = await DocxPackage.open(data || source); return [pkg, model(pkg)]; };

it('preserves unresolved bindings and custom stores through control edits, export and exact undo', async () => {
  const bytes = readFileSync('public/fixtures/unresolved-bindings.docx');
  const [pkg, doc] = await open(bytes);
  expect(controls(doc)).toHaveLength(3);
  retained(bytes, await save(pkg, doc));
  const properties = d => controls(d).map(r => {
    const xml = new DOMParser().parseFromString(r.control.shell, 'application/xml');
    return serializeFragment(first(xml, 'sdtPr'));
  });
  const originalProperties = properties(doc);
  for (let i = 0; i < 3; i++) {
    const range = controls(doc)[i];
    doc.select(range.start + 1, range.start + 4); doc.replace('EDIT');
  }
  const edited = await save(pkg, doc), reopened = model(await DocxPackage.open(edited));
  expect(reopened.text).toBe(doc.text);
  expect(properties(reopened)).toEqual(originalProperties);
  retained(bytes, edited, true);
  while (doc.history.length) doc.undo();
  retained(bytes, await save(pkg, doc));
}, 60000);
function modified(change) {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  change(xml, first(xml, 'sdt'));
  bindUsedNamespaces(xml.documentElement);
  parts['word/document.xml'] = strToU8(serializeFragment(xml.documentElement)); return zipSync(parts);
}
function retained(before, after, edited = false) {
  const a = unzipSync(before), b = unzipSync(after); expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  for (const name of Object.keys(a)) if (!edited || name !== 'word/document.xml') expect(Buffer.from(b[name]).equals(Buffer.from(a[name])), name).toBe(true);
}

it('matches the independent native reference probe: partial bold retains the wrapper and text replacement removes it', async () => {
  const bytes = readFileSync('public/fixtures/temporary-control-formatting.docx');
  const [pkg, doc] = await open(bytes), range = controls(doc)[0];
  doc.select(range.start, range.start + 7); doc.toggleBold();
  const saved = await save(pkg, doc), reopened = model(await DocxPackage.open(saved));
  expect(controls(reopened)).toHaveLength(1);
  expect(controls(reopened)[0].runs.map(r => [r.text, r.bold])).toEqual([['Control', true], [' alpha', false]]);
  const xml = new DOMParser().parseFromString(strFromU8(unzipSync(saved)['word/document.xml']), 'application/xml');
  expect(first(first(xml, 'sdt'), 'id').getAttributeNS(W, 'val')).toBe('41');
  expect(first(first(xml, 'sdt'), 'temporary')).toBeTruthy();
  retained(bytes, saved, true);
  doc.select(range.start + 2); doc.replace('X'); expect(controls(doc)).toHaveLength(0);
  doc.undo(); expect(controls(doc)).toHaveLength(1);
  doc.undo(); retained(bytes, await save(pkg, doc));
});

it('loads rich temporary placeholders without altering layout, clipboard text or package bytes', async () => {
  const [pkg, doc] = await open(); expect(controls(doc)).toHaveLength(6);
  const measure = (text, s) => ({ width: text.length * s.fontSize * .6, ascent: s.fontSize, descent: s.fontSize / 3 });
  const layout = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
  const plain = model(pkg); for (const p of plain.paragraphs) for (const r of p.runs) delete r.contentControl;
  // Run metadata is deliberately absent from geometry and text measurement.
  expect(layout(doc).lines.map(l => [l.x, l.y, l.width, l.height])).toEqual(layout(plain).lines.map(l => [l.x, l.y, l.width, l.height]));
  doc.select(controls(doc)[0].start, controls(doc)[0].end); expect(doc.clipboardText()).toBe('[Your name]');
  retained(source, await save(pkg, doc));
});

it('preserves whole control XML after unrelated edits, paragraph changes and new text at the end boundary', async () => {
  const [pkg, doc] = await open(), original = controls(doc).map(r => r.control.shell);
  doc.select(0); doc.replace('Edited '); doc.select(controls(doc)[0].end); doc.replace(' AFTER');
  doc.setParagraphFormat({ alignment: 'right' });
  const bytes = await save(pkg, doc), reopened = await DocxPackage.open(bytes);
  expect(controls(doc).map(r => r.control.shell)).toEqual(original); expect(controls(reopened)).toHaveLength(6);
  expect(model(reopened).text).toBe(doc.text); expectBodyEditParts(unzipSync(bytes), unzipSync(source));
  while (doc.history.length) doc.undo(); retained(source, await save(pkg, doc));
});

it('replaces a whole placeholder using its input formatting, with one undo restoring every source part', async () => {
  const [pkg, doc] = await open(), range = controls(doc)[0], original = doc.text;
  doc.select(range.start + 3); doc.replace('Ada Á😀');
  expect(doc.text).toBe(original.replace('[Your name]', 'Ada Á😀')); expect(doc.history).toHaveLength(1);
  expect(controls(doc)).toHaveLength(5); expect(doc.selection.focus).toBe(range.start + 'Ada Á😀'.length);
  const run = doc.paragraphs[1].runs.find(r => r.text === 'Ada Á😀'); expect(run).toMatchObject({ bold: true, color: '2050C0', italic: false });
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text); expect(controls(reopened)).toHaveLength(5); expectBodyEditParts(unzipSync(bytes), unzipSync(source));
  doc.undo(); retained(source, await save(pkg, doc)); doc.redo(); expect(doc.text).toBe(reopened.text);
});

it('uses ordinary style inheritance when a placeholder has no input properties', async () => {
  const [pkg, doc] = await open(), range = controls(doc)[2]; doc.select(range.start); doc.replace('First');
  const run = doc.paragraphs.find(p => p.runs.some(r => r.text === 'First')).runs.find(r => r.text === 'First');
  expect(run.color).not.toBe('777777'); expect(run.properties).toBe('');
  expect(controls(model(await DocxPackage.open(await save(pkg, doc))))).toHaveLength(5);
});

// This integration case parses and exports the fixture repeatedly for reopen/undo.
it.each([false, true])('honors pending placeholder formatting with direct reset=%s and preserves undo', async clear => {
  const [pkg, doc] = await open(); doc.select(controls(doc)[0].start + 2);
  if (clear) doc.clearDirectTextFormatting();
  doc.setRunFormat({ italic: true }); doc.replace('Ada');
  const run = doc.paragraphs[1].runs.find(r => r.text === 'Ada');
  expect(run).toMatchObject({ italic: true, bold: !clear, color: clear ? 'auto' : '2050C0' });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.paragraphs[1].runs.find(r => r.text === 'Ada')).toMatchObject({ italic: true, bold: !clear });
  doc.undo(); retained(source, await save(pkg, doc));
}, 30000);

it.each([
  ['formatting', (d, r) => { d.select(r.start, r.start + 2); d.setRunFormat({ bold: true }); }],
  ['character style', (d, r) => { d.select(r.start, r.end); d.setCharacterStyle('Emphasis'); }],
  ['clear formatting', (d, r) => { d.select(r.start, r.end); d.clearDirectTextFormatting(); }],
])('retains temporary wrappers and saves changed runs for %s', async (_, edit) => {
  const [pkg, doc] = await open(); edit(doc, controls(doc)[1]);
  expect(controls(doc)).toHaveLength(6);
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.text).toBe(doc.text); expect(controls(reopened)).toHaveLength(6);
  const properties = d => controls(d)[1].runs.map(r => [r.text, r.bold, r.italic, r.color, r.styleId]);
  expect(properties(reopened)).toEqual(properties(doc));
  doc.undo(); retained(source, await save(pkg, doc));
});

it.each([
  ['interior text', (d, r) => { d.select(r.start + 2); d.replace('inserted'); }],
  ['paragraph split', (d, r) => { d.select(r.start + 2); d.replace('\n'); }],
  ['partial deletion', (d, r) => { d.select(r.start + 2, r.start + 4); d.replace(''); }],
  ['search replacement', d => d.replaceMatches('EXISTING', 'NEW', {}, true)],
  ['hyperlink', (d, r) => { d.select(r.start, r.end); d.setHyperlink('https://example.com/'); }],
])('unwraps only the modified control for %s and restores it on undo', async (_, edit) => {
  const [pkg, doc] = await open(); edit(doc, controls(doc)[1]);
  expect(controls(doc)).toHaveLength(5);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.text).toBe(doc.text); expect(controls(reopened)).toHaveLength(5);
  doc.undo(); retained(source, await save(pkg, doc));
});

it('keeps table-cell placeholders editable, pastes only text, and restores their wrappers on undo', async () => {
  const [pkg, doc] = await open(), range = controls(doc)[4];
  doc.select(range.start, range.end); const copied = doc.clipboardText(); doc.replace(''); expect(controls(doc)).toHaveLength(5);
  doc.replace(copied); expect(controls(doc)).toHaveLength(5); expect(doc.text).toBe(model(pkg).text);
  doc.undo(); doc.undo(); retained(source, await save(pkg, doc));
});

it('uses placeholder input formatting for literal search replacements and leaves surrounding text unchanged', async () => {
  const [pkg, doc] = await open(); doc.replaceMatches('name', 'Ada', {}, true);
  expect(doc.text).toBe(model(pkg).text.replace('name', 'Ada')); expect(controls(doc)).toHaveLength(5);
  const inserted = doc.paragraphs[1].runs.find(r => r.text === 'Ada'); expect(inserted).toMatchObject({ bold: true, color: '2050C0', italic: false });
  expect(model(await DocxPackage.open(await save(pkg, doc))).text).toBe(doc.text);
  doc.undo(); retained(source, await save(pkg, doc));
});

it('unwraps a control when an added bookmark divides its content, preserving bookmark positions on export', async () => {
  const [pkg, doc] = await open(), range = controls(doc)[1]; doc.select(range.start + 1, range.end - 1); doc.addBookmark('Inside');
  expect(controls(doc)).toHaveLength(5);
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.bookmarks[0]).toMatchObject({ name: 'Inside', start: range.start + 1, end: range.end - 1 });
  doc.undo(); retained(source, await save(pkg, doc));
});

it('keeps enclosing bookmarks and shared style edits outside unchanged control contents', async () => {
  const [pkg, doc] = await open(), range = controls(doc)[1]; doc.select(range.start, range.end); doc.addBookmark('Around');
  doc.editParagraphStyle('Normal', { run: { fontSize: 14 } }); expect(controls(doc)).toHaveLength(6);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(controls(reopened)).toHaveLength(6);
  expect(reopened.bookmarks[0]).toMatchObject({ start: range.start, end: range.end });
  doc.undo(); doc.undo(); retained(source, await save(pkg, doc));
});

it('unwraps a control when adjacent typing joins its last character into a new grapheme', async () => {
  const [pkg, doc] = await open(), range = controls(doc)[1]; doc.select(range.end); doc.replace('\u0301');
  expect(controls(doc)).toHaveLength(5); expect(model(await DocxPackage.open(await save(pkg, doc))).text).toBe(doc.text);
  doc.undo(); retained(source, await save(pkg, doc));
});

it('rejects source control boundaries inside a grapheme', async () => {
  await expect(DocxPackage.open(modified((x, s) => { first(s, 't').textContent = '\u0301Prompt'; s.previousElementSibling.getElementsByTagNameNS(W, 't')[0].textContent = 'A'; }))).rejects.toThrow(/grapheme/);
});

it('preserves adjacent control namespaces after their paragraph is edited and reopened', async () => {
  const [pkg, doc] = await open(); const at = controls(doc)[3].end; doc.select(at); doc.replace(' tail');
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(controls(reopened)).toHaveLength(6); expect(reopened.text).toBe(doc.text);
});

it.each([
  ['locked', (x, s) => first(s, 'lock').setAttributeNS(W, 'w:val', 'sdtLocked')],
  ['bound', (x, s) => first(s, 'sdtPr').append(x.createElementNS(W, 'w:dataBinding'))],
  ['plain text widget', (x, s) => first(s, 'sdtPr').append(x.createElementNS(W, 'w:text'))],
  ['invalid boolean', (x, s) => first(s, 'temporary').setAttributeNS(W, 'w:val', 'yes')],
  ['duplicate property', (x, s) => first(s, 'sdtPr').append(first(s, 'temporary').cloneNode(true))],
  ['duplicate identity', x => x.getElementsByTagNameNS(W, 'id')[1].setAttributeNS(W, 'w:val', '-1')],
  ['noninteger identity', (x, s) => first(s, 'id').setAttributeNS(W, 'w:val', '1.5')],
  ['empty', (x, s) => first(s, 'sdtContent').replaceChildren()],
  ['nested', (x, s) => first(s, 'sdtContent').append(s.cloneNode(true))],
  ['bookmark inside', (x, s) => first(s, 'sdtContent').append(x.createElementNS(W, 'w:bookmarkStart'))],
  ['unknown attribute', (x, s) => s.setAttribute('unknown', '1')],
  ['unknown extension', (x, s) => first(s, 'sdtPr').append(x.createElementNS('urn:unknown', 'bad:property'))],
  ['visible appearance', (x, s) => s.getElementsByTagNameNS('*', 'appearance')[0].setAttributeNS('http://schemas.microsoft.com/office/word/2012/wordml', 'w15:val', 'tags')],
  ['invalid input formatting', (x, s) => { const size = x.createElementNS(W, 'w:sz'); size.setAttributeNS(W, 'w:val', 'not-a-size'); first(s, 'rPr').append(size); }],
])('rejects %s controls before editable attachment', async (_, edit) => {
  await expect(DocxPackage.open(modified(edit))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
