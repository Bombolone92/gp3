import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { WP, A } from '../src/engine/docx-images.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { imageCropRect, normalizeCrop, OBJECT, EMU_PER_INCH } from '../src/engine/images.js';
import { layoutDocument, caretRect, imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/cropped-images.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const pictures = doc => doc.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const parse = bytes => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
const node = (xml, ns, name) => xml.getElementsByTagNameNS(ns, name)[0];
const a14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.1, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
function geometry(result) {
  return [...result.lines, ...result.repeatedLines].map(l => ({ page: l.page, y: l.y, height: l.height, baseline: l.baseline, start: l.start, end: l.end, fragments: l.fragments.map(f => [f.x, f.width, f.ascent, f.start, f.end]) }));
}
function equalParts(actual, expected, except = []) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}

it('reads percentage and integer crop offsets with preserved local-DPI extensions and exact no-edit bytes', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  expect(pictures(doc).map(i => i.crop)).toEqual([
    { left: 25000, top: 12500, right: 0, bottom: 12500 },
    { left: -25000, top: -25000, right: -25000, bottom: -25000 },
    { left: 125000, top: 0, right: -50000, bottom: 0 },
    { left: 50000, top: 0, right: 0, bottom: 0 },
    { left: 12345, top: 0, right: 0, bottom: 0 }, normalizeCrop(),
  ]);
  expect(Object.keys(pkg.assets)).toHaveLength(2); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('maps cropped pixels and transparent outsets into the same frame, including off-image viewports', () => {
  expect(imageCropRect({ left: 25000, top: 12500, bottom: 12500 }, 64, 32)).toEqual({ source: [16, 4, 48, 24], destination: [0, 0, 1, 1] });
  const outset = imageCropRect({ left: -25000, right: -25000, top: -25000, bottom: -25000 }, 64, 32);
  expect(outset.source).toEqual([0, 0, 64, 32]); expect(outset.destination).toEqual([1 / 6, 1 / 6, 2 / 3, 2 / 3]);
  expect(imageCropRect({ left: -50000, right: 25000, top: 25000 }, 64, 32)).toEqual({ source: [0, 8, 48, 24], destination: [.4, 0, .6, 1] });
  expect(imageCropRect({ left: 125000, right: -50000 }, 64, 32)).toBeNull();
  expect(imageCropRect({ top: -50000, bottom: 125000 }, 64, 32)).toBeNull();
});

it('accepts exact equivalent percentage spellings, zero destination offsets and XML boolean DPI flags', async () => {
  const parts = unzipSync(source), xml = parse(parts['word/document.xml']);
  node(xml, A, 'srcRect').setAttribute('l', '+25000'); node(xml, A, 'srcRect').setAttribute('t', '12.50000%');
  node(xml, A, 'fillRect').setAttribute('l', '0.0%'); node(xml, A, 'fillRect').setAttribute('b', '-0%');
  for (const [index, value] of ['true', 'false'].entries()) xml.getElementsByTagNameNS(a14, 'useLocalDpi')[index].setAttribute('val', value);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  expect(pictures(doc)[0].crop).toEqual({ left: 25000, top: 12500, right: 0, bottom: 12500 }); equalParts(unzipSync(await save(pkg, doc)), parts);
});

it('edits crop atomically without changing text, pagination, frame selection or shared asset instances', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), initial = layout(doc), text = doc.text, at = text.indexOf(OBJECT);
  doc.select(at, at + 1); const before = doc.snapshot(), first = pictures(doc)[0], others = pictures(doc).slice(1);
  const crop = { left: 50000 }; expect(doc.setImageProperties({ crop })).toBe(true); crop.left = 0;
  expect(doc.selectedImage.crop.left).toBe(50000); expect(first.crop.left).toBe(25000);
  expect(doc.setImageProperties({ crop: { left: 50000 } })).toBe(false);
  expect(doc.text).toBe(text); expect(pictures(doc).slice(1)).toEqual(others); expect(geometry(layout(doc))).toEqual(geometry(initial));
  const after = doc.snapshot(); doc.undo(); expect(doc.snapshot()).toEqual(before); equalParts(unzipSync(await save(pkg, doc)), pkg.parts); doc.redo(); expect(doc.snapshot()).toEqual(after);
  doc.setImageProperties({ width: 1.5 * EMU_PER_INCH, height: .75 * EMU_PER_INCH });
  const bytes = await save(pkg, doc), out = unzipSync(bytes), xml = parse(out['word/document.xml']);
  expect(node(xml, A, 'srcRect').getAttribute('l')).toBe('50000');
  expect(node(node(xml, A, 'xfrm'), A, 'ext').getAttribute('cx')).toBe(String(1.5 * EMU_PER_INCH));
  expect(node(xml, A, 'ext').hasAttribute('cx')).toBe(false); // Extension record is not the transform extent.
  expect(node(xml, a14, 'useLocalDpi').getAttribute('val')).toBe('0');
  equalParts(out, pkg.parts, ['word/document.xml']);
  expect(pictures(model(await DocxPackage.open(bytes)))[0]).toMatchObject({ crop: normalizeCrop({ left: 50000 }), width: 1.5 * EMU_PER_INCH });
  doc.setImageProperties({ crop: {} });
  const reset = parse(unzipSync(await save(pkg, doc))['word/document.xml']); expect(node(reset, WP, 'inline').getElementsByTagNameNS(A, 'srcRect')).toHaveLength(0);
});

it('keeps crop and source positions through inherited spacing, repeated-header selection and text editing', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), initial = layout(doc), positions = [...doc.text.matchAll(/\ufffc/g)].map(m => m.index);
  const repeated = initial.repeatedLines.find(l => l.fragments.some(f => f.image)), f = repeated.fragments.find(f => f.image);
  expect(f.start).toBe(positions[3]); doc.select(f.start, f.end); doc.setImageProperties({ crop: { right: 50000 } });
  const cropped = layout(doc); expect(geometry(cropped)).toEqual(geometry(initial));
  expect(imageAtPoint(cropped, repeated.page, f.x + f.width / 2, repeated.baseline - f.ascent / 2).start).toBe(f.start);
  expect(caretRect(cropped, f.start, 'forward', repeated.page).page).toBe(repeated.page);
  expect(selectionRects(cropped, f.start, f.end).filter(r => r.width >= f.width - 1e-6).length).toBeGreaterThan(1);
  doc.editParagraphStyle('CanvasPictureText', { paragraph: { lineSpacing: 2 } });
  expect(layout(doc).lines.find(l => l.fragments.some(x => x.image?.id === 1)).height).toBeGreaterThan(initial.lines.find(l => l.fragments.some(x => x.image?.id === 1)).height);
  expect(pictures(doc)[3].crop).toEqual(normalizeCrop({ right: 50000 })); doc.undo();
  doc.select(positions[0] + 1); doc.replace(' edited'); doc.insertParagraph();
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes)); expect(reopened.text).toBe(doc.text); expect(pictures(reopened).map(i => i.crop)).toEqual(pictures(doc).map(i => i.crop));
  expect(node(parse(unzipSync(bytes)['word/document.xml']), A, 'srcRect').getAttribute('t')).toBe('12.5%');
  doc.select(positions[0], positions[0] + 1); doc.delete(-1); expect(pictures(doc)).toHaveLength(5); doc.undo(); expect(pictures(doc)).toHaveLength(6);
  while (doc.history.length) doc.undo(); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('saves authored crop with one shared media part and validates invalid edits before history changes', async () => {
  const sourcePkg = await DocxPackage.open(source), pkg = createDocx([paragraph('New ')]), doc = model(pkg);
  doc.assets.panels = Object.values(sourcePkg.assets)[0]; doc.select(doc.text.length); doc.insertImage('panels', { width: EMU_PER_INCH, height: EMU_PER_INCH / 2 });
  for (const crop of [{ left: 100000 }, { top: 50000, bottom: 50000 }, { left: 1000001 }, { right: .1 }, { top: NaN }, { bottom: null }, { other: 0 }, null]) {
    const before = doc.snapshot(), count = doc.history.length; expect(() => doc.setImageProperties({ crop })).toThrow(); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(count);
  }
  doc.setImageProperties({ crop: { right: 50000, top: 25000, bottom: 25000 } });
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(pictures(reopened)[0].crop).toEqual(normalizeCrop({ right: 50000, top: 25000, bottom: 25000 })); expect(Object.keys(reopened.assets)).toHaveLength(1);
});

it.each([
    xml => node(xml, A, 'srcRect').setAttribute('l', '100000'),
    xml => node(xml, A, 'srcRect').setAttribute('t', '1.0001%'),
    xml => node(xml, A, 'srcRect').setAttribute('t', '0.00000000001%'),
    xml => node(xml, A, 'srcRect').setAttribute('t', 'NaN'),
    xml => node(xml, A, 'srcRect').setAttribute('t', '1000.001%'),
    xml => node(xml, A, 'srcRect').append(xml.createElementNS(A, 'a:unsupported')),
    xml => node(xml, A, 'fillRect').setAttribute('l', '10000'),
    xml => node(xml, A, 'blip').setAttribute('cstate', 'unknown'),
    xml => node(xml, A, 'ext').setAttribute('uri', '{unknown}'),
    xml => node(xml, a14, 'useLocalDpi').setAttribute('val', 'on'),
    xml => node(xml, a14, 'useLocalDpi').append(xml.createElementNS(a14, 'a14:imgProps')),
    xml => node(xml, A, 'extLst').append(node(xml, A, 'ext').cloneNode(true)),
])('rejects unsupported crop geometry, extensions and malformed DPI before editable import: %#', async mutate => {
    const parts = unzipSync(source), xml = parse(parts['word/document.xml']); mutate(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
    await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/pictures/);
});

it('accepts the signed DrawingML integer range without allocating enlarged source images', () => {
  expect(normalizeCrop({left:-2147483648,right:2147483647})).toMatchObject({left:-2147483648,right:2147483647});
  const rect=imageCropRect({left:-1500000},64,32);
  expect(rect.source).toEqual([0,0,64,32]);
  expect(rect.destination).toEqual([15/16,0,1/16,1]);
  expect(imageCropRect({left:2147483647,right:-2147483648},64,32)).toBeNull();
  for(const left of [-2147483649,2147483648,Infinity,1.5])expect(()=>normalizeCrop({left})).toThrow(/32-bit/);
});

it('imports and preserves original large source/destination rectangle declarations',async()=>{
  const bytes=readFileSync('tests/fixtures/large-picture-rectangles/controls.docx');
  const pkg=await DocxPackage.open(bytes),doc=model(pkg);
  expect(pictures(doc)).toHaveLength(8);
  equalParts(unzipSync(await save(pkg,doc)),pkg.parts);
  doc.select(0);doc.replace('Edited ');
  const edited=await save(pkg,doc);expectBodyEditParts(unzipSync(edited),pkg.parts);
  expect(pictures(model(await DocxPackage.open(edited)))).toHaveLength(8);
  doc.undo();equalParts(unzipSync(await save(pkg,doc)),pkg.parts);
});
