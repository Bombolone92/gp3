import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { tabLeader } from '../src/engine/tab-leaders.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/tab-leaders.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables).arrayBuffer());
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const find = (doc, prefix) => doc.paragraphs.find(p => paragraphText(p).startsWith(prefix));
const select = (doc, text) => doc.select(doc.text.indexOf(text));
const stop = (leader, alignment = 'right', position = 4320) => ({ position, alignment, ...(leader ? { leader } : {}) });
function sameParts(a, b, except = []) { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const key of Object.keys(a)) if (!except.includes(key)) expect(Buffer.from(a[key]).equals(Buffer.from(b[key])), key).toBe(true); }

it('imports all leader forms, inherited stops, explicit none, clear and default stops without changing package parts', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  expect(find(doc, 'Inherited').format.tabs).toEqual([stop('dot', 'right', 6480)]);
  expect(find(doc, 'Direct none').format.tabs).toEqual([stop(undefined, 'right', 6480)]);
  expect(find(doc, 'Clear inherited').format.tabs).toEqual([]);
  expect(find(doc, 'Default').format.tabs).toEqual([]);
  for (const leader of ['dot', 'hyphen', 'underscore', 'heavy', 'middleDot']) expect(find(doc, leader + ' price').format.tabs[0].leader).toBe(leader);
  sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits inherited leaders, preserves Unicode selection and undo bytes, and round-trips only tab declarations', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Inherited'); const before = doc.snapshot();
  doc.setParagraphFormat({ tabs: [stop('hyphen', 'right', 6480)] });
  const exported = await save(pkg, doc), reopened = model(await DocxPackage.open(exported));
  expect(reopened.text).toBe(doc.text); expect(find(reopened, 'Inherited').format.tabs[0].leader).toBe('hyphen');
  sameParts(unzipSync(exported), pkg.parts, ['word/document.xml']);
  doc.undo(); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); expect(doc.paragraphFormatting.tabs[0].leader).toBe('hyphen');
  const current = doc.snapshot(); expect(doc.setParagraphFormat({ tabs: [stop('hyphen', 'right', 6480)] })).toBe(false); expect(doc.snapshot()).toEqual(current);
  select(doc, 'Á😀'); doc.select(doc.selection.focus, doc.selection.focus + 4); const range = doc.range;
  doc.setParagraphFormat({ tabs: [stop('middleDot')] }); doc.undo(); expect(doc.range).toEqual(range);
});

it('updates inherited style leaders while retaining direct none and can split and merge styled paragraphs', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.editParagraphStyle('CanvasLeaderBase', { paragraph: { tabs: [stop('underscore', 'right', 6480)] } });
  expect(find(doc, 'Inherited').format.tabs[0].leader).toBe('underscore'); expect(find(doc, 'Direct none').format.tabs[0].leader).toBeUndefined();
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(find(reopened, 'Inherited').format.tabs[0].leader).toBe('underscore');
  select(doc, 'Inherited'); doc.select(doc.selection.focus + 9); const original = doc.text; doc.insertParagraph();
  expect(doc.paragraphFormatting.tabs[0].leader).toBe('underscore'); doc.delete(-1); expect(doc.text).toBe(original);
  doc.undo(); doc.undo(); doc.undo(); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it.each([['left', 384], ['center', 364], ['right', 344], ['decimal', 368]])('fills the actual %s tab gap and preserves source carets', (alignment, right) => {
  const doc = new TextDocument([paragraph('X\t12.34', { format: { tabs: [stop('dot', alignment)] } })]);
  const result = layout(doc), line = result.lines[0], leader = line.leaders[0];
  expect(leader.x).toBe(104); expect(leader.x + leader.width).toBe(right); expect(leader.text).toMatch(/^\.+$/); expect(measure(leader.text, leader).width + leader.textOffsetX).toBeLessThanOrEqual(leader.width);
  const caret = caretRect(result, 2); expect(caret.x).toBe(right); expect(hitTest(result, caret.page, caret.x, caret.y + caret.height / 2)).toBe(2);
  expect(selectionRects(result, 1, 2)[0].width).toBe(leader.width); expect(line.stops).toHaveLength(8); expect(doc.text).toBe('X\t12.34');
});

it('uses the tab run formatting, including script transforms, and keeps no leaders when a field consumes the gap', () => {
  const doc = new TextDocument([paragraph('', { runs: [{ text: 'X', fontSize: 12 }, { text: '\t', fontSize: 18, bold: true, color: '993366', verticalAlign: 'superscript' }, { text: 'End', fontSize: 12 }], format: { tabs: [stop('middleDot')] } })]);
  const l = layout(doc).lines[0].leaders[0]; expect(l).toMatchObject({ fontSize: 18, bold: true, color: '993366', verticalAlign: 'superscript' }); expect(l.textTransform).toBeTruthy();
  const crowded = new TextDocument([paragraph('12345\tLONG', { format: { tabs: [stop('dot', 'right', 720)] } })]); expect(layout(crowded).lines[0].leaders).toEqual([]);
});

it('preserves wrapping, AutoFit demand, pagination, repeated headers and numbering geometry', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc);
  expect(before.pageCount).toBeGreaterThan(1); expect(before.repeatedLines.some(l => l.leaders.length)).toBe(true);
  const numbered = before.lines.find(l => l.paragraphId === find(doc, 'Numbered').id); expect(numbered.marker).toBeTruthy(); expect(numbered.leaders.length).toBe(1);
  const wrapped = before.lines.filter(l => l.paragraphId === find(doc, 'Wrapped').id); expect(wrapped[0].leaders).toHaveLength(1); expect(wrapped.slice(1).every(l => !l.leaders.length)).toBe(true);
  doc.select(0, doc.text.length); for (const p of doc.paragraphs) p.format.tabs = p.format.tabs.map(t => ({ ...t, leader: 'none' }));
  const after = layout(doc), geometry = l => ({ start: l.start, end: l.end, page: l.page, y: l.y, height: l.height, stops: l.stops });
  expect(after.lines.map(geometry)).toEqual(before.lines.map(geometry)); expect(after.tableWidths).toEqual(before.tableWidths); expect(after.pageCount).toBe(before.pageCount);
});

it.each(['dot', 'hyphen', 'underscore', 'heavy', 'middleDot', 'none'])('authors and reopens %s without inserting leader characters', async leader => {
  const doc = new TextDocument([paragraph('Name\tValue')]); doc.setParagraphFormat({ tabs: [stop(leader)] });
  const pkg = createDocx(doc.paragraphs), reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.text).toBe('Name\tValue'); expect(reopened.paragraphFormatting.tabs).toEqual(doc.paragraphFormatting.tabs);
});

it.each(['w:leader="invalid"', 'w:leader=""', 'w:leader="dot" w:unexpected="1"'])('rejects malformed tab leader attributes: %s', async attrs => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('w:leader="dot"', attrs));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/tab/i);
});
it.each(['<w:tab w:val="left" w:pos="720"><w:b/></w:tab>', '<w:tab w:val="left" w:pos="720">text</w:tab>', '<![CDATA[text]]><w:tab w:val="left" w:pos="720"/>', '<w:tab w:val="left" w:pos="720"/></w:tabs><w:tabs><w:tab w:val="right" w:pos="1440"/>'])('rejects malformed tab content before editing: %s', async content => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(/<w:tabs>.*?<\/w:tabs>/, `<w:tabs>${content}</w:tabs>`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/tab/i);
});
it('rejects invalid model leaders atomically and nonpositive or excessive leader advances during layout', () => {
  const doc = new TextDocument([paragraph('A\tB')]), before = doc.snapshot(); expect(() => doc.setParagraphFormat({ tabs: [stop('invalid')] })).toThrow(/leader/); expect(doc.snapshot()).toEqual(before);
  expect(() => tabLeader({ leader: 'dot', style: {} }, 0, 100, () => ({ width: 0 }))).toThrow(/spacing/);
  expect(() => tabLeader({ leader: 'dot', style: {} }, 0, 100, text => ({ width: text.length * .0001 }))).toThrow(/dense/);
});

it('uses whole page-grid glyphs without changing the tab gap or painting a partial final glyph', () => {
  const tab = { leader: 'dot', style: { fontSize: 12, characterSpacing: 0 } };
  const period = text => ({ width: text.length * 4, ascent: 12, descent: 4 });
  const leader = tabLeader(tab, 101.3, 18.7, period);
  expect(leader.text).toBe('....');
  expect(leader.x + leader.textOffsetX).toBe(104);
  expect(leader.x + leader.width).toBe(120);
  expect(tab.style).toEqual({ fontSize: 12, characterSpacing: 0 });
  expect(tabLeader(tab, 101.3, 5, period)).toBeNull();
  expect(tabLeader(tab, 104, 4, period).text).toBe('.');
  expect(tabLeader(tab, 104, 3.9, period)).toBeNull();
});

it.each(['', '-margin', '-kinds', '-formatting'])('preserves every OPC part of the independent reference grid fixture%s', async suffix => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/tab-leader-grid${suffix}.docx`));
  sameParts(unzipSync(await save(pkg, model(pkg))), pkg.parts);
});

it.each(['caps', 'smallCaps'])('keeps the leader grid offset in %s paint segments', capitalization => {
  const doc = new TextDocument([paragraph('A\t12', { format: { tabs: [stop('dot')] } })]);
  for (const run of doc.paragraphs[0].runs) Object.assign(run, { capitalization, fontSize: 13, textScale: 80 });
  const leader = layout(doc).lines[0].leaders[0];
  expect(leader.textOffsetX).toBeGreaterThan(0);
  expect(leader.textParts).toHaveLength(1);
  expect(leader.textParts[0].x).toBeCloseTo(leader.textOffsetX, 8);
  expect(leader.textParts[0].text).toBe(leader.text);
  expect(leader.textTransform.scaleX).toBe(.8);
});

it('retains AutoFit widths and moves leaders with paragraph alignment and trailing tabs', async () => {
  const doc = model(await DocxPackage.open(source)); doc.tables[0].layout = 'autofit'; const before = layout(doc);
  for (const p of doc.paragraphs) p.format.tabs = p.format.tabs.map(t => ({ ...t, leader: 'none' }));
  expect(layout(doc).tableWidths).toEqual(before.tableWidths);
  const p = paragraph('A\t', { format: { tabs: [stop('dot', 'left', 1440)] } }), simple = new TextDocument([p]);
  const left = layout(simple).lines[0]; simple.setParagraphFormat({ alignment: 'right' }); const right = layout(simple).lines[0];
  expect(right.leaders[0].x - left.leaders[0].x).toBe(right.stops[0].x - left.stops[0].x);
  expect(right.leaders[0].width).toBe(left.leaders[0].width); expect(right.leaders[0].x + right.leaders[0].width).toBe(right.stops.at(-1).x);
});

it('removes inherited leaders without removing the stop and clears inherited positions when moved', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 'Inherited');
  doc.setParagraphFormat({ tabs: [stop('none', 'right', 6480)] }); let reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(find(reopened, 'Inherited').format.tabs).toEqual([stop(undefined, 'right', 6480)]); expect(layout(reopened).lines.find(l => l.paragraphId === find(reopened, 'Inherited').id).leaders).toEqual([]);
  doc.setParagraphFormat({ tabs: [stop('dot', 'right', 6000)] }); const parts = unzipSync(await save(pkg, doc));
  expect(strFromU8(parts['word/document.xml'])).toContain('w:val="clear" w:pos="6480"'); reopened = model(await DocxPackage.open(zipSync(parts)));
  expect(find(reopened, 'Inherited').format.tabs).toEqual([stop('dot', 'right', 6000)]);
});
