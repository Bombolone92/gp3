import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects, nearestStop } from '../src/engine/layout.js';
import { cellIntrinsicWidths } from '../src/engine/intrinsic-widths.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const segments = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
const measure = text => ({ width: segments(text).length * 8, ascent: 15, descent: 5, underlineOffset: 2, underlineThickness: 1 });
const page = { width: 58, height: 66, margin: 10 };
const p = (text, format = {}, run = {}) => paragraph('', { format: { spaceAfter: 0, ...format }, runs: [{ text, ...run }] });
const layout = (text, settings = {}, format = {}, run = {}) => layoutDocument([p(text, format, run)], measure, { ...page, ...settings });
const sourceLines = (result, text) => result.lines.map(l => text.slice(l.start, l.end));
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const modelLayout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.stops, l.fragments.map(f => [f.text, f.x, f.width]), l.underlines, l.backgrounds]), cells: result.cells.map(c => [c.page, c.x, c.y, c.width, c.height]) });
function sameParts(actual, expected, except = []) {
  if (except.length) return expectBodyEditParts(actual, expected, except);
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true);
}

it('keeps overflowing word separators on the preceding line without introducing blank lines or pages', () => {
  const text = 'AVAV AVAV AVAV AVAV', result = layout(text);
  expect(sourceLines(result, text)).toEqual(['AVAV ', 'AVAV ', 'AVAV ', 'AVAV']); expect(result.pageCount).toBe(2);
  const old = layout(text, { wrapTrailSpaces: true }); expect(sourceLines(old, text)).toEqual(['AVAV', ' ', 'AVAV', ' ', 'AVAV', ' ', 'AVAV']); expect(old.pageCount).toBe(4);
});

it.each([' ', ' '.repeat(100), 'AB' + ' '.repeat(100), ' '.repeat(100) + 'CD', 'AB' + ' '.repeat(100) + 'CD'])('retains every source space, including leading and all-space lines (%#)', text => {
  const result = layout(text, { height: 200 }); expect(sourceLines(result, text).join('')).toBe(text);
  expect(result.lines.length).toBe(text.endsWith('CD') ? 2 : 1);
  for (const line of result.lines) for (const stop of line.stops) expect(stop.x).toBeLessThanOrEqual(48);
});

it.each([['left', 10], ['center', 21], ['right', 32]])('aligns %s by the visible content and bounds trailing backgrounds and carets', (alignment, x) => {
  const result = layout('AB     ', {}, { alignment }, { underline: true, highlight: 'yellow' }), line = result.lines[0];
  expect(line.fragments[0].x).toBe(x); expect(line.underlines[0]).toMatchObject({ x, width: 16 });
  expect(line.backgrounds[0].x + line.backgrounds[0].width).toBe(48);
  expect(line.fragments[0].x + line.fragments[0].width).toBe(48);
  expect(caretRect(result, 7).x).toBe(48);
});

it('underlines interior spaces, suppresses trailing spaces by default and honors ulTrailSpace in both wrapping modes', () => {
  for (const wrapTrailSpaces of [false, true]) for (const ulTrailSpace of [false, true]) {
    const result = layout('A B  ', { width: 100, wrapTrailSpaces, ulTrailSpace }, {}, { underline: true });
    expect(result.lines[0].underlines[0].width).toBe(ulTrailSpace ? 40 : 24);
  }
  const only = layout(' '.repeat(100), {}, {}, { underline: true }); expect(only.lines[0].underlines).toEqual([]);
  const on = layout(' '.repeat(100), { ulTrailSpace: true }, {}, { underline: true }); expect(on.lines[0].underlines[0].width).toBe(38);
});

it('preserves Unicode boundaries, hard breaks, indents and custom tab anchors', () => {
  for (const space of ['\u00a0', '\u202f', '\u2007', ' \u0301']) {
    const text = 'ABCD' + space + 'E', result = layout(text, { height: 200 }); expect(result.lines[0].end).toBe(4); expect(result.lines[0].ignoredTrailingWidth).toBe(0);
    expect(result.lines.every(l => segments(text).some(s => s.index === l.start))).toBe(true);
  }
  const text = 'Á😀   \vCD   \fE', result = layout(text, { height: 200 }); expect(result.lines.map(l => l.hardBreak)).toEqual(['line', 'page', null]); expect(result.lines.at(-1).page).toBe(1);
  const tabs = layout('A\tB   ', { width: 140 }, { tabs: [{ position: 1200, alignment: 'right' }], indentRight: 150 });
  expect(tabs.lines[0].fragments[1].x + 8).toBe(90); // Layout aligns B's end, excluding its ordinary-space tail.
  expect(tabs.lines[0].stops.at(-1).x).toBe(114); // All three editable spaces retain their advances.
  const indent = layout('AB    ', { width: 100 }, { indentLeft: 150, indentRight: 150, firstLine: 150 }); expect(indent.lines[0].fragments[0].x).toBe(30); expect(indent.lines[0].stops.at(-1).x).toBe(78);
});

it('maps collapsed trailing carets and selections to the writing edge and gives pointer/vertical hits a stable end position', () => {
  const text = 'AB' + ' '.repeat(10) + 'CD', result = layout(text, { height: 200 }), first = result.lines[0];
  for (let at = 5; at <= 12; at++) expect(caretRect(result, at, 'backward').x).toBe(48);
  expect(caretRect(result, 12).y).toBeGreaterThan(caretRect(result, 12, 'backward').y);
  expect(hitTest(result, 0, 48, first.y + first.height / 2)).toBe(12); expect(nearestStop(first, 48).offset).toBe(12);
  expect(selectionRects(result, 5, 11)[0]).toMatchObject({ x: 47, width: 1 });
  const aligned = layout('AB   ', {}, { alignment: 'right' }); expect(selectionRects(aligned, 2, 5)[0]).toMatchObject({ x: 47, width: 1 });
});

it('measures long space tails with linear work and retains geometry across run boundaries', () => {
  let shaped = 0;
  const ps = [p('AB' + ' '.repeat(10000))];
  const result = layoutDocument(ps, (text, style) => { shaped += text.length; return measure(text, style); }, page);
  expect(result.lines).toHaveLength(1); expect(result.lines[0].stops).toHaveLength(10003); expect(shaped).toBeLessThan(10100);
  const mixed = paragraph('', { runs: [{ text: 'AB ', underline: true }, { text: '  ', bold: true, underline: true, fontSize: 20 }, { text: ' ', color: 'FF0000', highlight: 'yellow' }] });
  const line = layoutDocument([mixed], measure, page).lines[0]; expect(line.ignoredTrailingWidth).toBe(32); expect(line.underlines.reduce((s,u) => s + u.width, 0)).toBe(16); expect(line.stops.at(-1).offset).toBe(6);
});

it('excludes hanging spaces from AutoFit minima, maxima and the indivisible-grapheme floor', () => {
  const metrics = (text, wrapTrailSpaces = false) => cellIntrinsicWidths({ margins: { left: 0, right: 0 }, content: [{ paragraph: p(text), index: 0 }] }, measure, { wrapTrailSpaces }, undefined, []);
  expect(metrics('AB CD     ')).toEqual({ min: 16, max: 40, floor: 8, paddingFloor: .4, contentMin: 16 }); expect(metrics('AB CD     ', true)).toEqual({ min: 24, max: 80, floor: 8, paddingFloor: .4, contentMin: 24 });
  expect(metrics(' '.repeat(100))).toEqual({ min: .4, max: .4, floor: .4, paddingFloor: .4, contentMin: 0 }); expect(metrics('AB\u00a0CD').min).toBe(40);
});

// Keep the full multi-export/undo integration flow together on slower runners.
it.each([false, true])('opens independent fixture wrapping=%s, preserves spaces, edits inherited formatting and restores byte-exact full undo', async wrap => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/${wrap ? 'wrapped' : 'trailing'}-spaces.docx`)), doc = model(pkg), initial = modelLayout(doc), before = doc.snapshot();
  expect(doc.pageSettings.wrapTrailSpaces).toBe(wrap); expect(doc.pageSettings.ulTrailSpace).toBe(wrap); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.select(0); doc.replace('Edited '); doc.select(doc.text.indexOf('Centered'), doc.text.indexOf('Centered') + 8); doc.setRunFormat({ bold: true }); doc.editParagraphStyle('SpaceStyle', { run: { fontSize: 14 } });
  const out = await save(pkg, doc), reopened = model(await DocxPackage.open(out)); expect(reopened.text).toBe(doc.text); expect(geometry(modelLayout(reopened))).toEqual(geometry(modelLayout(doc))); sameParts(unzipSync(out), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); expect(modelLayout(doc)).toEqual(initial); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); doc.redo(); expect(reopened.text).toBe(doc.text);
  expect(initial.repeatedLines.length).toBeGreaterThan(0);
  if (!wrap) {
    const repeated = initial.repeatedLines.find(l => l.hangingRight);
    expect(repeated).toBeDefined(); const caret = caretRect(initial, repeated.end, 'backward', repeated.page);
    expect(hitTest(initial, caret.page, caret.x, caret.y + caret.height / 2)).toBe(repeated.end);
    expect(selectionRects(initial, repeated.end - 2, repeated.end).some(r => r.page === repeated.page && r.width === 1)).toBe(true);
  }
  for (const line of [...initial.lines, ...initial.repeatedLines].filter(l => l.cellId)) {
    const cell = initial.cells.find(c => c.id === line.cellId && c.page === line.page);
    for (const f of [...line.fragments, ...line.backgrounds, ...line.underlines]) expect(f.x + f.width).toBeLessThanOrEqual(cell.x + cell.width + 1e-6);
  }
}, 30000);

it('serializes fresh compatibility flags in schema order and keeps imported flags read-only across page edits', async () => {
  const pkg = createDocx([p('AB     ')], { wrapTrailSpaces: true, ulTrailSpace: true, noTabHangInd: true, suppressSpBfAfterPgBrk: true, allowSpaceOfSameStyleInTable: true }), doc = model(pkg);
  for (const key of ['wrapTrailSpaces', 'ulTrailSpace']) { expect(() => doc.setPageSettings({ [key]: false })).toThrow(/compatibility/); expect(() => pkg.export(doc.paragraphs, { ...doc.pageSettings, [key]: false })).toThrow(/compatibility/); }
  doc.setPageSettings({ left: 1200 }); const out = await DocxPackage.open(await save(pkg, doc)); expect(out.pageSettings).toMatchObject({ wrapTrailSpaces: true, ulTrailSpace: true, left: 1200 }); expect(out.parts['word/settings.xml']).toEqual(pkg.parts['word/settings.xml']);
  const xml = new DOMParser().parseFromString(strFromU8(out.parts['word/settings.xml']), 'application/xml'); expect([...xml.getElementsByTagNameNS(W, 'compat')[0].children].map(n => n.localName)).toEqual(['noTabHangInd', 'ulTrailSpace', 'suppressSpBfAfterPgBrk', 'wrapTrailSpaces', 'allowSpaceOfSameStyleInTable']);
});

function revisedSpaceSetting(key, change) {
  const parts = unzipSync(readFileSync('public/fixtures/wrapped-spaces.docx'));
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/settings.xml']), 'application/xml');
  change(xml.getElementsByTagNameNS(W, key)[0]);
  parts['word/settings.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  return zipSync(parts);
}
// Separate imports/round trips must not share one five-second timeout.
for (const key of ['wrapTrailSpaces', 'ulTrailSpace']) {
  it.each([null, 'true', 'false', 'on', 'off', '1', '0'])(`preserves ${key} lexical value %s through editing and reopening`, async value => {
    const pkg = await DocxPackage.open(revisedSpaceSetting(key, n => value === null ? n.removeAttributeNS(W, 'val') : n.setAttributeNS(W, 'w:val', value))), doc = model(pkg);
    expect(doc.pageSettings[key]).toBe(!['false', 'off', '0'].includes(value));
    doc.select(0); doc.replace('Edited ');
    const settings = part => ({ 'word/settings.xml': part.parts['word/settings.xml'] });
    expectBodyEditParts(settings(await DocxPackage.open(await save(pkg, doc))), settings(pkg));
  });
  it.each([
    ['invalid boolean', n => n.setAttributeNS(W, 'w:val', 'yes')],
    ['duplicate element', n => n.after(n.cloneNode(true))],
    ['unknown child', n => n.append(n.ownerDocument.createElementNS(W, 'w:b'))],
    ['unknown attribute', n => n.setAttributeNS(W, 'w:other', '1')],
  ])(`rejects ${key} with %s before editable open`, async (_label, change) => {
    await expect(DocxPackage.open(revisedSpaceSetting(key, change))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
  });
}
