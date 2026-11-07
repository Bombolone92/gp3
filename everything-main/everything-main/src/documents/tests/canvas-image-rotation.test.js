import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { WP, A, PIC } from '../src/engine/docx-images.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { EMU_PER_INCH as INCH, EMU_PER_PX as PX, ANGLE_PER_DEGREE as DEG, imageExtents, rotationOutsets } from '../src/engine/images.js';
import { layoutDocument, caretRect, imageAtPoint, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/rotated-images.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const pictures = doc => doc.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const parse = bytes => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
const node = (xml, ns, name) => xml.getElementsByTagNameNS(ns, name)[0];
const measure = (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.1, descent: style.fontSize / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, index = 0) => { const at = [...doc.text.matchAll(/\ufffc/g)][index].index; doc.select(at, at + 1); };
function equalParts(actual, expected, except = []) {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
}
async function modified(mutate) {
  const parts = unzipSync(source), xml = parse(parts['word/document.xml']); mutate(xml);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}

it('reads independently generated signed and multi-turn angles, reserved extents, crops and flips with exact no-edit preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), images = pictures(doc);
  expect(images.map(i => i.rotation / DEG)).toEqual([30, 270, 90, 45, 0, 315]);
  expect(images[0]).toMatchObject({ width: 1.25 * INCH, height: .625 * INCH, flipH: true, flipV: false, crop: { left: 25000, top: 12500 } });
  expect(images[0].effectExtent.left - images[0].effectExtent.right).toBe(.05 * INCH);
  expect(images[0].effectExtent.bottom - images[0].effectExtent.top).toBe(.03 * INCH);
  equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
  select(doc); doc.select(doc.range[1]); doc.replace(' rotated');
  const bytes = await save(pkg, doc), xml = parse(unzipSync(bytes)['word/document.xml']);
  expect([...xml.getElementsByTagNameNS(A, 'xfrm')].map(n => n.getAttribute('rot'))).toEqual(['1800000', '-5400000', '27000000', '2700000', '18900000']);
  expect(pictures(model(await DocxPackage.open(bytes)))).toMatchObject(images.map(({ shell, ...i }) => i));
  doc.undo(); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('reserves native inline orientation bands and only declared extra space', () => {
  const image = { width: 120 * PX, height: 60 * PX };
  for (const angle of [0, 180, -180, 360, 720]) expect(rotationOutsets({ ...image, rotation: angle * DEG })).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  for (const angle of [90, 270, -90, 450]) expect(imageExtents({ ...image, rotation: angle * DEG })).toEqual({ left: 0, top: 0, right: 0, bottom: 0, width: 60 * PX, height: 120 * PX });
  const rotated = imageExtents({ ...image, rotation: 45 * DEG });
  expect(rotated.width / PX).toBe(60); expect(rotated.height / PX).toBe(120);
  expect(imageExtents({ ...image, rotation: 45 * DEG, flipH: true, flipV: true })).toEqual(rotated);
  expect(imageExtents({ ...image, effectExtent: { left: 3, top: 5, right: 7, bottom: 11 } })).toMatchObject({ width: 120 * PX + 10, height: 60 * PX + 16 });
});

it('rotates and resizes without changing base dimensions, shared pictures or authored extra space; undo restores every part', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc); const before = doc.snapshot(), others = pictures(doc).slice(1);
  doc.setImageProperties({ rotation: -90 * DEG }); expect(doc.selectedImage.rotation).toBe(270 * DEG);
  expect(doc.setImageProperties({ rotation: 630 * DEG })).toBe(false);
  expect(doc.selectedImage).toMatchObject({ width: 1.25 * INCH, height: .625 * INCH, effectExtent: { left: .05 * INCH, right: 0, top: 0, bottom: .03 * INCH } });
  doc.setImageProperties({ width: 1.5 * INCH, height: .75 * INCH });
  expect(doc.selectedImage.effectExtent).toEqual({ left: .05 * INCH, right: 0, top: 0, bottom: .03 * INCH });
  expect(pictures(doc).slice(1)).toEqual(others); const after = doc.snapshot();
  const bytes = await save(pkg, doc), parts = unzipSync(bytes), xml = parse(parts['word/document.xml']);
  expect(node(xml, A, 'xfrm').getAttribute('rot')).toBe('16200000'); expect(node(xml, A, 'xfrm').getAttribute('flipH')).toBe('true');
  expect(node(xml, WP, 'extent').getAttribute('cx')).toBe(String(1.5 * INCH));
  expect(node(xml, WP, 'effectExtent').getAttribute('t')).toBe('0');
  expect(node(xml, A, 'srcRect').getAttribute('t')).toBe('12.5%'); equalParts(parts, pkg.parts, ['word/document.xml']);
  expect(pictures(model(await DocxPackage.open(bytes)))[0]).toMatchObject({ rotation: 270 * DEG, effectExtent: doc.selectedImage.effectExtent });
  doc.undo(); doc.undo(); expect(doc.snapshot()).toEqual(before); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
  doc.redo(); doc.redo(); expect(doc.snapshot()).toEqual(after);
});

it('uses reserved extents for inline advances, AutoFit, pagination, inherited spacing and repeated-header caret/selection', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), initial = layout(doc);
  expect(initial.pageCount).toBeGreaterThan(2);
  for (const l of [...initial.lines, ...initial.repeatedLines]) for (const f of l.fragments.filter(f => f.image)) {
    expect(f.width).toBeCloseTo(imageExtents(f.image).width / PX, 6); expect(f.ascent).toBeCloseTo(imageExtents(f.image).height / PX, 6);
    expect(imageAtPoint(initial, l.page, f.x + f.width / 2, l.baseline - f.ascent / 2).start).toBe(f.start);
  }
  const repeated = initial.repeatedLines.find(l => l.fragments.some(f => f.image)), f = repeated.fragments.find(f => f.image);
  expect(caretRect(initial, f.start, 'forward', repeated.page).page).toBe(repeated.page);
  expect(selectionRects(initial, f.start, f.end).filter(r => r.width >= f.width - 1e-6).length).toBeGreaterThan(1);
  const first = result => result.lines.find(l => l.fragments.some(f => f.image?.id === 1));
  doc.editParagraphStyle('CanvasPictureText', { paragraph: { lineSpacing: 2 } }); expect(first(layout(doc)).height).toBeGreaterThan(first(initial).height); doc.undo();
  select(doc); doc.setParagraphFormat({ lineRule: 'exact', lineSpacing: 15 }); const clipped = layout(doc), line = first(clipped), frame = line.fragments.find(f => f.image);
  expect(line.clip).toBe(true); expect(imageAtPoint(clipped, line.page, frame.x + 2, line.y - 1)).toBeNull(); doc.undo();
  select(doc, 5); doc.setImageProperties({ rotation: 0 });
  const oldAuto = initial.lines.flatMap(l => l.fragments).find(f => f.image?.id === 6), newAuto = layout(doc).lines.flatMap(l => l.fragments).find(f => f.image?.id === 6);
  expect(newAuto.width).toBeLessThan(oldAuto.width); expect(newAuto.ascent).toBeLessThan(oldAuto.ascent);
  select(doc, 3); doc.setImageProperties({ rotation: 90 * DEG });
  expect(layout(doc).repeatedLines.filter(l => l.fragments.some(f => f.image)).every(l => l.fragments.find(f => f.image).image.rotation === 90 * DEG)).toBe(true);
  const reopened = model(await DocxPackage.open(await save(pkg, doc))); expect(layout(reopened).pageCount).toBe(layout(doc).pageCount); expect(reopened.text).toBe(doc.text);
  while (doc.history.length) doc.undo(); equalParts(unzipSync(await save(pkg, doc)), pkg.parts);
});

it('authors arbitrary rotation and adds a missing transform in schema order', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc, 4); doc.setImageProperties({ rotation: 22.5 * DEG });
  const xml = parse(unzipSync(await save(pkg, doc))['word/document.xml']), shape = xml.getElementsByTagNameNS(PIC, 'spPr')[4];
  expect(shape.firstElementChild.localName).toBe('xfrm'); expect([...shape.firstElementChild.children].map(n => n.localName)).toEqual(['off', 'ext']);
  expect(shape.firstElementChild.getAttribute('rot')).toBe('1350000');
  const fresh = createDocx([paragraph('New ')]), authored = model(fresh); authored.assets.panels = Object.values(pkg.assets)[0]; authored.select(authored.text.length);
  authored.insertImage('panels', { width: INCH, height: INCH / 2, rotation: -30 * DEG });
  const reopened = model(await DocxPackage.open(await save(fresh, authored))); expect(pictures(reopened)[0]).toMatchObject({ width: INCH, height: INCH / 2, rotation: 330 * DEG });
  expect(imageExtents(pictures(reopened)[0])).toEqual(imageExtents(authored.selectedImage));
});

it('hits horizontal overflow ink, excludes vertically clipped ink and bounds selection to the line', () => {
  const image = {width:40*PX,height:70*PX,rotation:45*DEG,effectExtent:{left:0,top:0,right:0,bottom:0}};
  const f={image,start:0,end:1,x:100,width:70,ascent:40,descent:0};
  const line={page:0,start:0,end:1,x:100,y:100,width:70,height:43,baseline:140,fragments:[f],stops:[{offset:0,x:100},{offset:1,x:170}]};
  const result={page:{width:816},lines:[line]};
  expect(imageAtPoint(result,0,98,130)).toBe(f);
  expect(imageAtPoint(result,0,135,90)).toBeNull();
  expect(imageAtPoint(result,0,170,102)).toBeNull();
  const rect=selectionRects(result,0,1).find(r=>r.x<100);
  expect(rect.y).toBe(100);expect(rect.height).toBe(43);
  expect(rect.width).toBeCloseTo(110/Math.sqrt(2));
});

it('validates angles and nonrotating fills before mutating history', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc);
  for (const rotation of [undefined, null, NaN, Infinity, 1.5, '30', 2147483648, -2147483649]) {
    const before = doc.snapshot(), history = doc.history.length;
    expect(() => doc.setImageProperties({ rotation })).toThrow(/rotation/); expect(doc.snapshot()).toEqual(before); expect(doc.history).toHaveLength(history);
  }
  const bytes = await modified(xml => { const t = node(xml, A, 'xfrm'); t.setAttribute('rot', '0'); node(xml, PIC, 'blipFill').setAttribute('rotWithShape', 'false'); });
  const stationary = model(await DocxPackage.open(bytes)); select(stationary);
  expect(() => stationary.setImageProperties({ rotation: 90 * DEG })).toThrow(/fill/); expect(stationary.history).toHaveLength(0);
  expect(stationary.setImageProperties({ alt: 'Stationary fill' })).toBe(true);
  const zero = await modified(xml => { node(xml, A, 'off').setAttribute('x', '+000'); node(xml, A, 'off').setAttribute('y', '-0'); });
  const zeroPkg = await DocxPackage.open(zero); equalParts(unzipSync(await save(zeroPkg, model(zeroPkg))), zeroPkg.parts);
});

// Each independent import gets its own assertion report and timeout budget.
it.each([
  ...['false', '', '1.2', '2147483648', '-2147483649'].map(v => [`rotation ${JSON.stringify(v)}`, xml => node(xml, A, 'xfrm').setAttribute('rot', v)]),
  ['negative left outset', xml => node(xml, WP, 'effectExtent').setAttribute('l', '-1')],
  ['missing bottom outset', xml => node(xml, WP, 'effectExtent').removeAttribute('b')],
  ['mismatched inner width', xml => node(node(xml, A, 'xfrm'), A, 'ext').setAttribute('cx', '999')],
  ['stationary rotated fill', xml => node(xml, PIC, 'blipFill').setAttribute('rotWithShape', 'false')],
  ['invalid fill rotation flag', xml => node(xml, PIC, 'blipFill').setAttribute('rotWithShape', 'yes')],
  ['invalid origin', xml => node(xml, A, 'off').setAttribute('x', 'false')],
  ['missing origin', xml => node(xml, A, 'off').removeAttribute('y')],
  ['unknown origin attribute', xml => node(xml, A, 'off').setAttribute('z', '0')],
  ['unknown origin child', xml => node(xml, A, 'off').appendChild(xml.createElementNS(A, 'a:ext'))],
])('rejects %s before editable picture open', async (_label, mutate) => {
  await expect(DocxPackage.open(await modified(mutate))).rejects.toThrow(/pictures/);
});
