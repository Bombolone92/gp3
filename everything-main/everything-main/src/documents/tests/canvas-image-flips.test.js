import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { WP, A, PIC } from '../src/engine/docx-images.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { OBJECT, EMU_PER_INCH } from '../src/engine/images.js';
import { layoutDocument, caretRect, imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/flipped-images.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const pictures = doc => doc.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const parse = bytes => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
const node = (xml, ns, name) => xml.getElementsByTagNameNS(ns, name)[0];
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.1, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const positions = doc => [...doc.text.matchAll(/\ufffc/g)].map(m => m.index);
const select = (doc, index) => { const at = positions(doc)[index]; doc.select(at, at + 1); };
const flips = doc => pictures(doc).map(i => [i.flipH, i.flipV]);
const geometry = result => [...result.lines, ...result.repeatedLines].map(l => [l.page, l.y, l.height, l.baseline, l.start, l.end, ...l.fragments.map(f => [f.x, f.width, f.ascent, f.start, f.end])]);
function equalParts(actual, expected, except = []) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}

it('reads both flip axes, XML booleans and absent transforms from an independent fixture with exact no-edit export', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  expect(flips(doc)).toEqual([[true, false], [false, true], [true, true], [true, true], [false, false], [false, false]]);
  expect(pictures(doc)[0].crop).toEqual({ left: 25000, top: 12500, right: 0, bottom: 12500 }); expect(Object.keys(pkg.assets)).toHaveLength(2);
  equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('edits one flip without altering frame geometry, shared image instances, selection or pagination', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), initial = layout(doc), text = doc.text;
  select(doc, 0); const before = doc.snapshot(), image = doc.selectedImage, others = pictures(doc).slice(1);
  expect(doc.setImageProperties({ flipV: true })).toBe(true); expect(doc.setImageProperties({ flipV: true })).toBe(false);
  expect(image.flipV).toBe(false); expect(pictures(doc).slice(1)).toEqual(others); expect(doc.selectedImage.crop).toEqual(image.crop); expect(doc.text).toBe(text);
  expect(geometry(layout(doc))).toEqual(geometry(initial)); const after = doc.snapshot();
  doc.undo(); expect(doc.snapshot()).toEqual(before); equalParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); expect(doc.snapshot()).toEqual(after);
  const bytes = await save(pkg, doc), parts = unzipSync(bytes), xml = parse(parts['word/document.xml']), transform = node(xml, A, 'xfrm');
  expect(transform.getAttribute('flipH')).toBe('true'); expect(transform.getAttribute('flipV')).toBe('1'); expect(transform.getAttribute('rot')).toBe('0');
  expect(node(xml, A, 'srcRect').getAttribute('t')).toBe('12.5%'); equalParts(parts, pkg.parts, ['word/document.xml']);
  expect(flips(model(await DocxPackage.open(bytes)))[0]).toEqual([true, true]);
});

it('creates a missing transform in schema order and preserves dimensions, crop and local-DPI extension metadata', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 4);
  expect(doc.setImageProperties({ flipH: true, width: 1.5 * EMU_PER_INCH, height: .75 * EMU_PER_INCH })).toBe(true);
  const bytes = await save(pkg, doc), xml = parse(unzipSync(bytes)['word/document.xml']), inline = xml.getElementsByTagNameNS(WP, 'inline')[4];
  const shape = node(inline, PIC, 'spPr'), transform = shape.firstElementChild;
  expect(transform.namespaceURI).toBe(A); expect(transform.localName).toBe('xfrm'); expect(transform.getAttribute('flipH')).toBe('1'); expect(transform.hasAttribute('flipV')).toBe(false);
  expect([...transform.children].map(n => n.localName)).toEqual(['off', 'ext']); expect(node(transform, A, 'off').getAttribute('x')).toBe('0');
  expect(node(transform, A, 'ext').getAttribute('cx')).toBe(String(1.5 * EMU_PER_INCH)); expect(node(inline, A, 'srcRect').getAttribute('l')).toBe('12.345%');
  expect(node(inline, A, 'ext').getAttribute('uri')).toBe('{28A0092B-C50C-407e-A947-70E740481C1C}'); expect(node(inline, A, 'ext').hasAttribute('cx')).toBe(false);
  expect(pictures(model(await DocxPackage.open(bytes)))[4]).toMatchObject({ flipH: true, flipV: false, width: 1.5 * EMU_PER_INCH });
  doc.undo(); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('preserves flipped repeated-header source positions, inherited spacing, exact-line clipping and editing history', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), initial = layout(doc);
  const line = initial.repeatedLines.find(l => l.fragments.some(f => f.image)), f = line.fragments.find(f => f.image); select(doc, 3);
  expect(doc.setImageProperties({ flipH: false, flipV: false })).toBe(true); const result = layout(doc); expect(geometry(result)).toEqual(geometry(initial));
  expect(imageAtPoint(result, line.page, f.x + f.width / 2, line.baseline - f.ascent / 2).start).toBe(f.start);
  expect(caretRect(result, f.start, 'forward', line.page).page).toBe(line.page); expect(selectionRects(result, f.start, f.end).filter(r => r.width >= f.width - 1e-6).length).toBeGreaterThan(1);
  doc.editParagraphStyle('CanvasPictureText', { paragraph: { lineSpacing: 2 } });
  expect(layout(doc).lines.find(l => l.fragments.some(x => x.image?.id === 1)).height).toBeGreaterThan(initial.lines.find(l => l.fragments.some(x => x.image?.id === 1)).height);
  expect(flips(doc)[0]).toEqual([true, false]); doc.undo();
  select(doc, 0); doc.setParagraphFormat({ lineRule: 'exact', lineSpacing: 15 });
  const clipped = layout(doc), clippedLine = clipped.lines.find(l => l.fragments.some(x => x.image?.id === 1)), clippedImage = clippedLine.fragments.find(x => x.image);
  expect(clippedLine.clip).toBe(true); expect(imageAtPoint(clipped, clippedLine.page, clippedImage.x + 2, clippedLine.y - 1)).toBeNull(); doc.undo();
  doc.select(positions(doc)[0] + 1); doc.replace(' flipped'); doc.insertParagraph(); select(doc, 2); doc.delete(-1); expect(pictures(doc)).toHaveLength(5); doc.undo();
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(reopened.text).toBe(doc.text); expect(flips(reopened)).toEqual(flips(doc));
  while (doc.history.length) doc.undo(); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('authors both flip axes, treats explicit false as a no-op default, and validates before changing history', async () => {
  const sourcePkg = await DocxPackage.open(source), pkg = createDocx([paragraph('New ')]), doc = model(pkg);
  doc.assets.panels = Object.values(sourcePkg.assets)[0]; doc.select(doc.text.length); doc.insertImage('panels', { width: EMU_PER_INCH, height: EMU_PER_INCH / 2 });
  expect(doc.setImageProperties({ flipH: false, flipV: false })).toBe(false);
  for (const value of [0, 1, 'true', 'false', null, undefined, {}]) {
    const before = doc.snapshot(), count = doc.history.length; expect(() => doc.setImageProperties({ flipH: value })).toThrow(/true or false/); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(count);
  }
  doc.setImageProperties({ flipH: true, flipV: true, crop: { left: -50000, top: -100000 } }); const before = doc.snapshot();
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(flips(reopened)).toEqual([[true, true]]); expect(pictures(reopened)[0].crop).toEqual(doc.selectedImage.crop);
  doc.setImageProperties({ flipH: false }); doc.undo(); expect(doc.snapshot()).toEqual(before); doc.redo(); expect(doc.selectedImage.flipH).toBe(false);
  expect(flips(model(await DocxPackage.open(await save(pkg, doc))))).toEqual([[false, true]]);
});

it('preserves a valid quarter-turn combined with a flipped picture through editing and reopening', async () => {
  const parts = unzipSync(source), xml = parse(parts['word/document.xml']);
  node(xml, A, 'xfrm').setAttribute('rot', '5400000');
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  expect(pictures(doc)[0]).toMatchObject({ rotation: 5400000, flipH: true, flipV: false });
  equalParts(unzipSync(await save(pkg, doc)), parts);
  select(doc, 0); const before = doc.snapshot();
  doc.setImageProperties({ flipV: true });
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(pictures(reopened)[0]).toMatchObject({ rotation: 5400000, flipH: true, flipV: true });
  doc.undo(); expect(doc.snapshot()).toEqual(before);
  equalParts(unzipSync(await save(pkg, doc)), parts);
});

it('rejects malformed flip booleans and angles, unsupported transforms and active editing locks', async () => {
  const mutations = [
    ...['on', 'off', 'yes', '2', ''].map(value => xml => node(xml, A, 'xfrm').setAttribute('flipH', value)),
    xml => node(xml, A, 'xfrm').setAttribute('flipV', 'no'),
    xml => node(xml, A, 'xfrm').setAttribute('rot', 'false'),
    xml => node(xml, A, 'xfrm').setAttribute('skew', '0'),
    xml => node(xml, A, 'off').setAttribute('x', '1'),
    xml => node(xml, A, 'graphicFrameLocks').setAttribute('noRot', '1'),
  ];
  for (const mutate of mutations) {
    const parts = unzipSync(source), xml = parse(parts['word/document.xml']); mutate(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
    await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/pictures/);
  }
});
