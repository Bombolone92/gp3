import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText, paragraphFormat } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/contextual-spacing.docx');
const tableSource = readFileSync('public/fixtures/contextual-table-spacing.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = text => ({ width: [...text].length * 8, ascent: 15, descent: 5 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const find = (doc, text) => doc.paragraphs.find(p => paragraphText(p) === text);
const format = (doc, text) => paragraphFormat(find(doc, text), doc.numbering);
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.baseline, l.stops]), cells: result.cells.map(c => [c.page, c.x, c.y, c.width, c.height]) });
function sameParts(actual, expected, except = []) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
function revise(path, change, bytes = source) {
  const parts = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(parts[path]), 'application/xml'); change(xml);
  parts[path] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
const node = (xml, tag, value) => { const n = xml.createElementNS(W, 'w:' + tag); if (value !== undefined) n.setAttributeNS(W, 'w:val', value); return n; };
const firstFlag = xml => xml.getElementsByTagNameNS(W, 'contextualSpacing')[0];
const namedStyle = (xml, id) => [...xml.getElementsByTagNameNS(W, 'style')].find(n => n.getAttributeNS(W, 'styleId') === id);
function gap(doc, result, a, b) {
  const last = result.lines.filter(l => l.paragraphId === find(doc, a).id).at(-1), next = result.lines.find(l => l.paragraphId === find(doc, b).id);
  expect(next.page, a + ' / ' + b).toBe(last.page);
  return next.y - last.y - last.height;
}

it('imports direct, default, inherited, table and numbering contexts with byte-exact preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, expected] of [['Spec first Á😀', true], ['Spec second', false], ['Inherited first', true], ['Different child', true], ['Style reset', false], ['Direct reset', false], ['Inherited list', true], ['Direct list', false], ['Direct list reset', true], ['Header first', true]]) expect(format(doc, text).contextualSpacing, text).toBe(expected);
  expect(find(doc, 'Implicit default').resolvedStyleId).toBe(find(doc, 'Explicit default').resolvedStyleId);
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('subtracts the specification’s one-sided spacing, floors double suppression, and compares style identity', async () => {
  const doc = model(await DocxPackage.open(source)), result = layout(doc);
  for (const [a, b, points] of [['Spec first Á😀', 'Spec second', 2], ['Both first', 'Both second', 0], ['Reverse first', 'Reverse second', 2], ['Inherited first', 'Inherited second', 0], ['Inherited second', 'Different child', 8], ['Different child', 'Child same', 0], ['Implicit default', 'Explicit default', 0]]) expect(gap(doc, result, a, b), a).toBeCloseTo(points * 4 / 3);
});

it('edits direct and shared flags, retains explicit off, round trips geometry and restores all bytes on undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Spec first Á😀'); const before = doc.snapshot(), initial = layout(doc);
  doc.setParagraphFormat({ contextualSpacing: false }); doc.editParagraphStyle('ContextBody', { paragraph: { contextualSpacing: false } });
  expect(gap(doc, layout(doc), 'Spec first Á😀', 'Spec second')).toBeCloseTo(16); expect(format(doc, 'Different child').contextualSpacing).toBe(false);
  doc.editParagraphStyle('ContextReset', { paragraph: { contextualSpacing: null } }); doc.editParagraphStyle('ContextBody', { paragraph: { contextualSpacing: true } });
  expect(format(doc, 'Style reset').contextualSpacing).toBe(true); expect(format(doc, 'Direct reset').contextualSpacing).toBe(false); expect(doc.selection).toEqual(before.selection);
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(geometry(layout(reopened))).toEqual(geometry(layout(doc))); expect(reopened.paragraphs.map(p => paragraphFormat(p, reopened.numbering))).toEqual(doc.paragraphs.map(p => paragraphFormat(p, doc.numbering)));
  sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  for (let i = 0; i < 4; i++) doc.undo(); expect(doc.snapshot()).toEqual(before); expect(layout(doc)).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  for (let i = 0; i < 4; i++) doc.redo(); expect(geometry(layout(doc))).toEqual(geometry(layout(reopened)));
});

it('retains paragraph spacing and contextual state through Unicode typing, splits, merges and mixed selections', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); doc.select(doc.paragraphOffset(14)); const before = doc.snapshot();
  doc.replace('Empty Á😀'); doc.insertParagraph(); doc.replace('Following'); expect(format(doc, 'Following').contextualSpacing).toBe(true);
  const at = doc.text.indexOf('Following'); doc.select(at - 1, at); doc.replace(''); expect(format(doc, 'Empty Á😀Following')).toMatchObject({ contextualSpacing: true, spaceBefore: 8, spaceAfter: 8 });
  expect(geometry(layout(model(await DocxPackage.open(await save(pkg, doc)))))).toEqual(geometry(layout(doc)));
  for (let i = 0; i < 4; i++) doc.undo(); expect(doc.snapshot()).toEqual(before);
  select(doc, 'Spec first Á😀\nSpec second'); expect(doc.paragraphFormatting.contextualSpacing).toBeNull(); const range = doc.range; doc.setParagraphFormat({ contextualSpacing: true }); expect(doc.range).toEqual(range); expect(doc.paragraphFormatting.contextualSpacing).toBe(true);
});

it('moves caret, selection and hit targets with contextual paragraph spacing', async () => {
  const doc = model(await DocxPackage.open(source)); select(doc, 'Spec first Á😀'); doc.setParagraphFormat({ contextualSpacing: false }); const before = layout(doc);
  doc.setParagraphFormat({ contextualSpacing: true }); const after = layout(doc), at = doc.text.indexOf('Spec second') + 2, a = caretRect(before, at), b = caretRect(after, at);
  expect(a.y - b.y).toBeCloseTo(40 / 3); expect(hitTest(after, b.page, b.x, b.y + b.height / 2)).toBe(at); expect(selectionRects(after, at, at + 2)[0].y).toBe(after.lines.find(l => l.start <= at && l.end >= at).y);
  const unicode = caretRect(after, doc.text.indexOf('😀') + 2); expect(hitTest(after, unicode.page, unicode.x, unicode.y + unicode.height / 2)).toBe(doc.text.indexOf('😀') + 2);
});

it('uses contextual gaps when fitting kept chains, preserves page-break boundaries and leaves line breaks inside paragraphs alone', () => {
  const p = (text, format = {}) => paragraph(text, { format: { spaceAfter: 0, ...format } });
  const ps = [p('Filler\vline'), p('Kept', { keepNext: true, contextualSpacing: true, spaceAfter: 15 }), p('Tail', { spaceBefore: 15 })];
  const page = { width: 240, height: 120, margin: 20 }, run = () => layoutDocument(ps, measure, page);
  expect(run().pageCount).toBe(1); ps[1].format.contextualSpacing = false; expect(run().lines.map(l => l.page)).toEqual([0, 0, 1, 1]);
  const manual = [p('Before', { contextualSpacing: true, spaceAfter: 15 }), p('After', { pageBreakBefore: true, contextualSpacing: true, spaceBefore: 15 })];
  const result = layoutDocument(manual, measure, page); expect(result.lines.map(l => [l.page, l.y])).toEqual([[0, 20], [1, 20]]);
  const leading = p('\fLeading\vLine', { contextualSpacing: true, spaceBefore: 9 }); const breaks = layoutDocument([leading], measure, { ...page, height: 180 });
  expect(breaks.lines.filter(l => l.page === 1 && !l.virtual).map(l => l.y)).toEqual([32, 52]);
});

it.each([false, true])('applies table compatibility %s inside cells and repeated headers while preserving the stored flag', async allow => {
  const pkg = await DocxPackage.open(allow ? tableSource : source), doc = model(pkg), result = layout(doc);
  expect(doc.pageSettings.allowSpaceOfSameStyleInTable).toBe(allow); expect(format(doc, 'Header first').contextualSpacing).toBe(true);
  expect(gap(doc, result, 'Header first', 'Header second')).toBeCloseTo(allow ? 8 : 0); expect(gap(doc, result, 'Cell before', 'Cell after')).toBeCloseTo(allow ? 8 : 0);
  expect(gap(doc, result, 'Spec first Á😀', 'Spec second')).toBeCloseTo(8 / 3);
  const id = find(doc, 'Header second').id, repeated = result.repeatedLines.find(l => l.paragraphId === id); expect(repeated).toBeDefined();
  const caret = caretRect(result, repeated.start + 2, 'forward', repeated.page); expect(hitTest(result, caret.page, caret.x, caret.y + caret.height / 2)).toBe(repeated.start + 2); expect(selectionRects(result, repeated.start, repeated.start + 2).some(r => r.page === repeated.page)).toBe(true);
  const rowTop = result.cells.find(c => c.id === find(doc, 'Header first').cellId && c.page === result.lines.find(l => l.paragraphId === find(doc, 'Header first').id).page).y;
  expect(result.lines.find(l => l.paragraphId === find(doc, 'Header first').id).y - rowTop).toBeCloseTo(8 + 1 / 3); // Initial spacing plus the .5pt border's inner half; preceding body paragraph has a different style.
  const tail = result.lines.find(l => l.paragraphId === find(doc, 'After table').id), lastPage = Math.max(...result.cells.map(c => c.page));
  const edge = Math.max(...result.cells.filter(c => c.page === lastPage).map(c => c.y + c.height)), gapAfter = 16 + 1 / 3;
  if (tail.page === lastPage) expect(tail.y - edge).toBeCloseTo(gapAfter);
  else {
    // Source-adjacent cell spacing changes row pagination. A full last page
    // must move this paragraph intact and suppress its leading page gap.
    const page = pageGeometry(doc.pageSettings);
    expect(edge + gapAfter + tail.height).toBeGreaterThan(page.height - page.bottom);
    expect(tail.page).toBe(lastPage + 1); expect(tail.y).toBe(page.top);
  }
  select(doc, 'Header first\nHeader second'); doc.setParagraphFormat({ contextualSpacing: false }); expect(gap(doc, layout(doc), 'Header first', 'Header second')).toBeCloseTo(8);
  const exported = await save(pkg, doc); sameParts(unzipSync(exported), pkg.parts, ['word/document.xml']); expect(geometry(layout(model(await DocxPackage.open(exported))))).toEqual(geometry(layout(doc)));
  doc.undo(); expect(layout(doc)).toEqual(result); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('reads document defaults and direct false resets without materializing inherited declarations', async () => {
  const pkg = await DocxPackage.open(revise('word/styles.xml', xml => { xml.getElementsByTagNameNS(W, 'pPrDefault')[0].firstElementChild.append(node(xml, 'contextualSpacing')); firstFlag(namedStyle(xml, 'ContextBody')).remove(); })), doc = model(pkg);
  expect(format(doc, 'Inherited first').contextualSpacing).toBe(true); expect(format(doc, 'Spec second').contextualSpacing).toBe(false); expect(doc.styles.definitions.ContextBody.properties.contextualSpacing).toBeUndefined(); expect(find(doc, 'Inherited first').styleContext.properties.contextualSpacing).toBeUndefined();
  select(doc, 'Inherited first'); doc.setRunFormat({ bold: true }); const out = model(await DocxPackage.open(await save(pkg, doc))); expect(format(out, 'Inherited first').contextualSpacing).toBe(true); expect(find(out, 'Inherited first').styleContext.properties.contextualSpacing).toBeUndefined();
});

it.each([[undefined, true], ['on', true], ['true', true], ['1', true], ['off', false], ['false', false], ['0', false]])('accepts on/off form %s and preserves its untouched lexical spelling', async (value, expected) => {
  const pkg = await DocxPackage.open(revise('word/document.xml', xml => { const n = firstFlag(xml); if (value === undefined) n.removeAttributeNS(W, 'val'); else n.setAttributeNS(W, 'w:val', value); })), doc = model(pkg); expect(format(doc, 'Spec first Á😀').contextualSpacing).toBe(expected);
  select(doc, 'Spec second'); doc.setRunFormat({ bold: true }); const out = await DocxPackage.open(await save(pkg, doc)); expect(find(model(out), 'Spec first Á😀').shell).toBe(find(doc, 'Spec first Á😀').shell);
});

it.each(['', 'yes', '2', 'TRUE', '-1'])('rejects malformed active on/off value %s before editable open', async value => {
  await expect(DocxPackage.open(revise('word/document.xml', xml => firstFlag(xml).setAttributeNS(W, 'w:val', value)))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('rejects duplicates, nested content and unknown attributes; preserves unused invalid styles and rejects applying them atomically', async () => {
  for (const change of [n => n.after(n.cloneNode(true)), n => n.append(node(n.ownerDocument, 'b')), n => n.setAttributeNS(W, 'w:extra', '1')]) await expect(DocxPackage.open(revise('word/document.xml', xml => change(firstFlag(xml))))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const bytes = revise('word/styles.xml', xml => { const style = namedStyle(xml, 'ContextBody').cloneNode(true); style.setAttributeNS(W, 'w:styleId', 'InvalidContext'); firstFlag(style).setAttributeNS(W, 'w:val', 'yes'); xml.documentElement.append(style); });
  const pkg = await DocxPackage.open(bytes), doc = model(pkg), before = doc.snapshot(); expect(() => doc.setParagraphStyle('InvalidContext')).toThrow(/contextualSpacing/); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  await expect(DocxPackage.open(revise('word/styles.xml', xml => firstFlag(namedStyle(xml, 'ContextBody')).setAttributeNS(W, 'w:val', 'yes')))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
}, 30000);

it('validates table compatibility and keeps it read-only through unrelated page edits', async () => {
  const pkg = await DocxPackage.open(tableSource), doc = model(pkg), before = doc.snapshot(); expect(() => doc.setPageSettings({ allowSpaceOfSameStyleInTable: false })).toThrow(/compatibility/); expect(doc.snapshot()).toEqual(before);
  expect(() => pkg.export(doc.paragraphs, { ...doc.pageSettings, allowSpaceOfSameStyleInTable: false })).toThrow(/compatibility/);
  doc.setPageSettings({ left: doc.pageSettings.left + 120 }); const out = await DocxPackage.open(await save(pkg, doc)); expect(out.pageSettings.allowSpaceOfSameStyleInTable).toBe(true); expect(out.parts['word/settings.xml']).toEqual(pkg.parts['word/settings.xml']);
  await expect(DocxPackage.open(revise('word/settings.xml', xml => xml.getElementsByTagNameNS(W, 'allowSpaceOfSameStyleInTable')[0].setAttributeNS(W, 'w:val', '2'), tableSource))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  const fresh = createDocx([paragraph('Compatibility')], { allowSpaceOfSameStyleInTable: true }); expect((await DocxPackage.open(new Uint8Array(await fresh.export().arrayBuffer()))).pageSettings.allowSpaceOfSameStyleInTable).toBe(true);
});

it('serializes generated numbering-level flags, gives direct paragraph edits precedence and rejects malformed active levels', async () => {
  const pkg = createDocx([paragraph('Item')]), doc = model(pkg); doc.toggleList('number'); const level = Object.values(doc.numbering.abstracts)[0].levels[0]; level.geometry.contextualSpacing = true;
  expect(doc.paragraphFormatting.contextualSpacing).toBe(true); const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(reopened.paragraphFormatting.contextualSpacing).toBe(true); expect(strFromU8(unzipSync(bytes)['word/numbering.xml'])).toContain('<w:contextualSpacing w:val="1"');
  reopened.setParagraphFormat({ contextualSpacing: false }); expect(reopened.paragraphFormatting.contextualSpacing).toBe(false);
  await expect(DocxPackage.open(revise('word/numbering.xml', xml => firstFlag(xml).setAttributeNS(W, 'w:val', 'bad')))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('rejects nonboolean direct and style edits atomically', async () => {
  const doc = model(await DocxPackage.open(source)), before = doc.snapshot();
  for (const contextualSpacing of [null, 0, 1, '', 'true', undefined]) { expect(() => doc.setParagraphFormat({ contextualSpacing })).toThrow(); if (contextualSpacing !== null) expect(() => doc.editParagraphStyle('ContextBody', { paragraph: { contextualSpacing } })).toThrow(); }
  expect(doc.snapshot()).toEqual(before);
});

it.each([false,true])('uses source-adjacent style context before aligning first cell paragraphs, compatibility=%s',async allow=>{
 const bytes=readFileSync('public/fixtures/cell-leading-space.docx'),p=await DocxPackage.open(bytes),d=model(p);
 const result=layoutDocument(d.paragraphs,measure,{...pageGeometry(d.pageSettings),allowSpaceOfSameStyleInTable:allow},d.numbering,d.tables);
 const baseline=(page,text)=>result.lines.find(l=>l.page===page&&l.fragments.map(f=>f.text).join('')===text).baseline;
 for(const page of [13,14,15]){
  expect(baseline(page,'top')-baseline(page,'center')).toBeCloseTo(allow?0:4/3);
  expect(baseline(page,'top')-baseline(page,'bottom')).toBeCloseTo(0);
 }
 expect(baseline(12,'top')-baseline(10,'top')).toBeCloseTo(allow?8/3:0);
 sameParts(unzipSync(await save(p,d)),p.parts);
});
