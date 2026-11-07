import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { capitalizationParts, resolveCapitalization } from '../src/engine/capitalization.js';
import { cellIntrinsicWidths } from '../src/engine/intrinsic-widths.js';
import { measureTextGeometry } from '../src/engine/text-geometry.js';
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/capitalization.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ ...fontMetrics(style), width: [...text].reduce((w, c) => w + (/[A-Z]/.test(c) ? .8 : .5) * style.fontSize, 0) });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const mode = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text)?.capitalization;
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start, l.end, l.page, l.y, l.height, l.baseline, l.stops, l.fragments.map(f => [f.text, f.x, f.width, f.textParts])]), cells: result.cells.map(c => [c.page, c.x, c.y, c.width, c.height]) });
function sameParts(actual, expected, except = []) { expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort()); for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true); }
function revise(part, change, bytes = source) { const parts = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(parts[part]), 'application/xml'); change(xml); parts[part] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts); }
const node = (xml, tag, val) => { const n = xml.createElementNS(W, 'w:' + tag); if (val !== undefined) n.setAttributeNS(W, 'w:val', val); return n; };
const style = (xml, id) => [...xml.getElementsByTagNameNS(W, 'style')].find(s => s.getAttributeNS(W, 'styleId') === id);

it('imports both modes, off declarations, character toggles, marks, tables and numbering with byte-exact no-edit export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const [text, expected] of [['Direct caps', 'caps'], ['Direct small', 'smallCaps'], ['Paragraph caps', 'caps'], ['Child off', 'normal'], ['Character reversed', 'normal'], ['Small reversed', 'normal'], ['Small kept', 'smallCaps'], ['Switch small on caps', 'smallCaps'], ['Caps off keeps small', 'smallCaps'], ['Small header', 'smallCaps'], ['Caps header', 'caps']]) expect(mode(doc, text), text).toBe(expected);
  expect(doc.paragraphs[14].markFormat.capitalization).toBe('smallCaps'); const marker = layout(doc).lines.find(l => l.marker).marker; expect(marker.text).toBe('item 1.'); expect(marker.textParts.map(p => p.text).join('')).toBe('ITEM 1.'); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('switches and clears either inherited form, removes conflicting source properties, reopens and restores byte-exact full undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), before = doc.snapshot(), original = layout(doc), text = doc.text;
  for (const target of ['Paragraph caps', 'Small kept']) { select(doc, target); doc.setRunFormat({ capitalization: target === 'Paragraph caps' ? 'smallCaps' : 'caps' }); doc.setRunFormat({ capitalization: 'normal' }); }
  const bytes = await save(pkg, doc), out = model(await DocxPackage.open(bytes)); expect(out.text).toBe(text); expect(mode(out, 'Paragraph caps')).toBe('normal'); expect(mode(out, 'Small kept')).toBe('normal'); expect(geometry(layout(out))).toEqual(geometry(layout(doc))); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml']);
  const xml = new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml'); for (const r of xml.getElementsByTagNameNS(W, 'rPr')) expect(r.getElementsByTagNameNS(W, 'caps').length + r.getElementsByTagNameNS(W, 'smallCaps').length).toBeLessThanOrEqual(1);
  doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.paragraphs).toEqual(before.paragraphs); expect(layout(doc)).toEqual(original); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits and removes shared declarations, preserves direct overrides and restores history', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), before = layout(doc);
  doc.editParagraphStyle('CapitalLetters', { run: { capitalization: 'capsOff' } }); expect(mode(doc, 'Paragraph caps')).toBe('normal'); expect(mode(doc, 'Character reversed')).toBe('caps'); expect(mode(doc, 'Direct caps')).toBe('caps');
  doc.editCharacterStyle('CapitalCharacter', { run: { capitalization: null } }); expect(mode(doc, 'Character reversed')).toBe('normal');
  const bytes = await save(pkg, doc), out = model(await DocxPackage.open(bytes)); expect(geometry(layout(out))).toEqual(geometry(layout(doc))); sameParts(unzipSync(bytes), pkg.parts, ['word/document.xml', 'word/styles.xml']);
  doc.undo(); doc.undo(); expect(layout(doc)).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); expect(mode(doc, 'Character reversed')).toBe('caps');
});

it.each(['caps', 'smallCaps'])('toggles character %s relative to document defaults', async kind => {
  const pkg = await DocxPackage.open(revise('word/styles.xml', xml => xml.getElementsByTagNameNS(W, 'rPrDefault')[0].firstElementChild.prepend(node(xml, kind)))), doc = model(pkg);
  expect(mode(doc, kind === 'caps' ? 'Character reversed' : 'Small reversed')).toBe(kind);
  expect(resolveCapitalization(kind, kind, true, kind)).toBe(kind); expect(resolveCapitalization(kind, kind + 'Off', true, kind)).toBe('normal');
  select(doc, 'Capitalization áß😀'); doc.setRunFormat({ capitalization: 'normal' }); expect(mode(model(await DocxPackage.open(await save(pkg, doc))), 'Capitalization áß😀')).toBe('normal');
});

it('uses proportional small capitals and ordinary spaces, preserves other nonletters, and clamps to the one-point floor', () => {
  expect(capitalizationParts('Hello, world! 123 áß😀', { capitalization: 'smallCaps', fontSize: 12 })).toEqual([{ text: 'H', fontSize: 12 }, { text: 'ELLO', fontSize: 9.5 }, { text: ',', fontSize: 12 }, { text: ' WORLD', fontSize: 9.5 }, { text: '!', fontSize: 12 }, { text: ' ', fontSize: 9.5 }, { text: '123', fontSize: 12 }, { text: ' ÁSS', fontSize: 9.5 }, { text: '😀', fontSize: 12 }]);
  expect(capitalizationParts('aB1', { capitalization: 'smallCaps', fontSize: 1.5 })).toEqual([{ text: 'A', fontSize: 1 }, { text: 'B1', fontSize: 1.5 }]);
  const style = { capitalization: 'smallCaps', fontSize: 12 }, m = measureTextGeometry('Aa!', style, measure); expect(m.width).toBeCloseTo(12 * .8 + 9.5 * .8 + 12 * .5); expect(m.ascent).toBe(fontMetrics(style).ascent);
});

it('retains authored line metrics on entirely reduced small-cap text without mutating source formatting', () => {
  const style = Object.freeze({ capitalization: 'smallCaps', fontSize: 21 });
  const lower = measureTextGeometry('alpha beta', style, measure), upper = measureTextGeometry('ALPHA BETA', style, measure);
  expect(lower.ascent).toBe(upper.ascent); expect(lower.descent).toBe(upper.descent);
  expect(lower.textParts).toEqual([{text:'ALPHA BETA',fontSize:17,x:0}]);
  expect(lower.width).toBeLessThan(upper.width);
  expect(capitalizationParts(' \u00a0\u2002\u2003\u2009\t!',style)).toEqual([{text:' ',fontSize:17},{text:'\u00a0\u2002\u2003\u2009\t!',fontSize:21}]);
});

it('allocates mixed-script small caps from the fonts actually used, excluding an unused ASCII face', () => {
  const style = {capitalization:'smallCaps',fontSize:12,fontAscii:'Unused',fontHAnsi:'Greek',fontEastAsia:'Han'};
  const m = measureTextGeometry('ω中',style,(text,s)=>({width:text.length*s.fontSize,ascent:({Greek:10,Han:12}[s.fontFamily]??99)*s.fontSize/12,descent:3}));
  expect(m.ascent).toBe(12);expect(m.descent).toBe(3);
  expect(m.textParts.map(p=>p.fontFamily)).toEqual(['Greek','Han']);
});

it('keeps expanded uppercase glyphs on original grapheme boundaries for carets, selections and hit testing', () => {
  for (const capitalization of ['caps', 'smallCaps']) {
    const text = 'áß😀z', doc = model(createDocx([paragraph('', { runs: [{ text, capitalization }] })])), result = layout(doc), line = result.lines[0];
    expect(doc.text).toBe(text); expect(line.stops.map(s => s.offset)).toEqual([0, 2, 3, 5, 6]); expect(line.fragments[0].textParts.map(p => p.text).join('')).toBe('ÁSS😀Z');
    for (const offset of [0, 2, 3, 5, 6]) { const c = caretRect(result, offset); expect(hitTest(result, c.page, c.x, c.y + c.height / 2)).toBe(offset); }
    expect(selectionRects(result, 2, 3)[0].width).toBeCloseTo((capitalization === 'caps' ? 12 : 9.5) * 1.6);
  }
});

it('preserves shaping across color boundaries, but separates capitalization modes', () => {
  const p = paragraph('', { runs: [{ text: 'a', capitalization: 'caps' }, { text: 'v', capitalization: 'caps', color: 'FF0000' }, { text: 'a', capitalization: 'smallCaps' }] });
  const line = layoutDocument([p], (text, style) => ({ ...fontMetrics(style), width: measure(text, style).width - (text === 'AV' ? 2 : 0) })).lines[0];
  expect(line.fragments).toHaveLength(2); expect(line.fragments[0].text).toBe('av'); expect(line.fragments[0].textParts[0].text).toBe('AV'); expect(line.fragments[0].width).toBeCloseTo(17.2); expect(line.fragments[0].colors).toHaveLength(2);
});

it('combines capitalization with script transforms, baseline shifts, spacing and width without changing source', () => {
  const style = { capitalization: 'smallCaps', fontSize: 24, verticalAlign: 'superscript', baselineShift: 3, textScale: 150, characterSpacing: 1, underline: true, strikethrough: 'double' };
  const p = paragraph('', { runs: [{ text: 'Aab', ...style }] }), line = layoutDocument([p], measure).lines[0], f = line.fragments[0];
  expect(f.text).toBe('Aab'); expect(f.textParts.map(p => p.fontSize)).toEqual([24, 19]); expect(f.width).toBeCloseTo((24 * .8 + 19 * .8 * 2) * .65 * 1.5); expect(f.textTransform.offsetY).toBeCloseTo(-32 * .35 - 4); expect(line.strikes).toHaveLength(2); expect(line.underlines).toHaveLength(1);
});

it('reflows pagination and AutoFit widths, reopens stable geometry and preserves repeated-header hit targets', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), original = layout(doc); doc.select(0, doc.text.length); doc.setRunFormat({ capitalization: 'caps' }); const result = layout(doc);
  expect(result.lines.map(l => l.end)).not.toEqual(original.lines.map(l => l.end)); expect(result.pageCount).toBeGreaterThanOrEqual(original.pageCount); expect(result.repeatedLines.length).toBeGreaterThan(0);
  const repeat = result.repeatedLines.find(l => l.end - l.start > 3), caret = caretRect(result, repeat.start + 2, 'forward', repeat.page); expect(hitTest(result, repeat.page, caret.x, caret.y + caret.height / 2)).toBe(repeat.start + 2); expect(selectionRects(result, repeat.start, repeat.start + 2).some(r => r.page === repeat.page)).toBe(true);
  expect(geometry(layout(model(await DocxPackage.open(await save(pkg, doc)))))).toEqual(geometry(result)); doc.undo(); expect(layout(doc)).toEqual(original);
});

it('preserves Unicode source through typing, splitting, merging, mixed selection and undo', async () => {
  const pkg = createDocx(), doc = model(pkg); doc.setRunFormat({ capitalization: 'smallCaps' }); doc.replace('áß😀'); doc.insertParagraph(); doc.replace('Tail'); expect(doc.paragraphs.every(p => p.runs.every(r => r.capitalization === 'smallCaps'))).toBe(true);
  doc.select(5, 6); doc.replace(''); expect(doc.text).toBe('áß😀Tail'); doc.select(0, 2); doc.setRunFormat({ capitalization: 'caps' }); doc.select(0, doc.text.length); expect(doc.runFormatting.capitalization).toBeNull(); const before = doc.snapshot(); doc.setRunFormat({ capitalization: 'normal' }); expect(model(await DocxPackage.open(await save(pkg, doc))).text).toBe(doc.text); doc.undo(); expect(doc.paragraphs).toEqual(before.paragraphs);
});

it.each(['caps', 'smallCaps'])('accepts legal %s booleans and rejects invalid active XML before editing', async tag => {
  for (const value of [undefined, '1', 'true', 'on', '0', 'false', 'off']) {
    const bytes = revise('word/document.xml', xml => { const old = xml.getElementsByTagNameNS(W, tag)[0]; old.replaceWith(node(xml, tag, value)); }), pkg = await DocxPackage.open(bytes); sameParts(unzipSync(await save(pkg, model(pkg))), pkg.parts);
  }
  for (const invalid of ['bad', '', 'TRUE']) await expect(DocxPackage.open(revise('word/document.xml', xml => xml.getElementsByTagNameNS(W, tag)[0].setAttributeNS(W, 'w:val', invalid)))).rejects.toThrow(/invalid/);
  await expect(DocxPackage.open(revise('word/document.xml', xml => xml.getElementsByTagNameNS(W, tag)[0].parentNode.append(node(xml, tag, '0'))))).rejects.toThrow();
});

it('preserves invalid unused styles, rejects exposing them atomically, and validates mutation declarations', async () => {
  const pkg = await DocxPackage.open(revise('word/styles.xml', xml => { const s = style(xml, 'CapitalCharacter').cloneNode(true); s.setAttributeNS(W, 'w:styleId', 'UnusedBad'); s.getElementsByTagNameNS(W, 'caps')[0].setAttributeNS(W, 'w:val', 'invalid'); xml.documentElement.append(s); })), doc = model(pkg), before = doc.snapshot();
  expect(() => doc.setCharacterStyle('UnusedBad')).toThrow(/invalid/); expect(doc.snapshot()).toEqual(before); sameParts(unzipSync(await save(pkg, doc)), pkg.parts);
  for (const value of [true, 'CAPS', 'capsOff']) expect(() => doc.setRunFormat({ capitalization: value })).toThrow(); expect(() => doc.editParagraphStyle('CapitalLetters', { run: { capitalization: 'normal' } })).toThrow();
});

it('serializes newly authored capitalization on numbering symbols', async () => {
  const pkg = createDocx([paragraph('Item')]), doc = model(pkg); doc.toggleList('number'); const level = Object.values(doc.numbering.abstracts)[0].levels[0]; level.text = 'item %1.'; level.markerStyle.capitalization = 'smallCaps'; const out = model(await DocxPackage.open(await save(pkg, doc))), marker = layout(out).lines[0].marker; expect(marker.textParts.map(p => p.text).join('')).toBe('ITEM 1.');
});

it('uses transformed widths for AutoFit min, max and indivisible grapheme floor', () => {
  const intrinsic = capitalization => cellIntrinsicWidths({ margins: { left: 0, right: 0 }, content: [{ paragraph: paragraph('', { runs: [{ text: 'aß', capitalization }] }), index: 0 }] }, (t,s) => measureTextGeometry(t,s,measure), {}, undefined, []);
  const normal = intrinsic('normal'), caps = intrinsic('caps'), small = intrinsic('smallCaps');
  expect(caps.min).toBeCloseTo(28.8); expect(small.min).toBeCloseTo(22.8); expect(normal.min).toBeCloseTo(12); expect(caps.floor).toBeCloseTo(19.2); expect(caps.max).toBeCloseTo(caps.min);
});

it('keeps kerning threshold decisions at the stored size when small capitals use smaller display fonts', () => {
  for (const kerning of [0, 11, 12, 12.5]) {
    const calls = [];
    const measured = measureTextGeometry('AvatAR', { capitalization: 'smallCaps', fontSize: 12, kerning }, (text, style) => { if (text) calls.push([text, style.fontSize, style.kerning > 0 && style.fontSize >= style.kerning]); return measure(text, style); });
    expect(calls).toEqual([['A', 12, kerning === 11 || kerning === 12], ['VAT', 9.5, kerning === 11 || kerning === 12], ['AR', 12, kerning === 11 || kerning === 12]]); expect(measured.width).toBeGreaterThan(0);
  }
});

it('rejects spacing with expanding uppercase mappings before import or mutation and leaves history unchanged', async () => {
  for (const capitalization of ['caps', 'smallCaps']) {
    const pkg = createDocx([paragraph('aß')]), doc = model(pkg); doc.select(0, 2); doc.setRunFormat({ capitalization }); const before = doc.snapshot(), history = doc.history.length;
    expect(() => doc.setRunFormat({ characterSpacing: 1 })).toThrow(/expanding uppercase/); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(history);
    doc.select(0, 1); doc.setRunFormat({ characterSpacing: 1 }); doc.select(1); const typing = doc.snapshot(), count = doc.history.length; expect(() => doc.replace('ß')).toThrow(/expanding uppercase/); expect(doc.snapshot()).toEqual(typing); expect(doc.history).toHaveLength(count);
    const bytes = revise('word/document.xml', xml => { const rpr = [...xml.getElementsByTagNameNS(W, 'r')].find(r => r.textContent === 'Hello, world! 123 áß😀').getElementsByTagNameNS(W, 'rPr')[0]; rpr.prepend(node(xml, capitalization)); rpr.insertBefore(node(xml, 'spacing', '20'), rpr.lastChild); });
    await expect(DocxPackage.open(bytes)).rejects.toThrow(/expanding uppercase/);
  }
});
