import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { A, WP, PIC } from '../src/engine/docx-images.js';
import { WPS, WPG } from '../src/engine/docx-compatibility.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/artwork-metadata.docx');
const DEC = 'http://schemas.microsoft.com/office/drawing/2017/decorative';
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const node = (r, ns, name) => r.getElementsByTagNameNS(ns, name)[0];
const images = doc => doc.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
const measure = (t, s) => ({ width: t.length * s.fontSize * .6, ascent: s.fontSize, descent: s.fontSize / 3 });
const layout = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
function changed(change) {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  change(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
function retained(bytes, parts, edited = false) {
  const out = unzipSync(bytes); expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());
  for (const [name, value] of Object.entries(parts)) if (!edited || name !== 'word/document.xml') expect(Buffer.from(out[name]).equals(Buffer.from(value)), name).toBe(true);
}

it('reads the independent artwork fixture without applying overridden theme styles', async () => {
  const pkg = await DocxPackage.open(source), [group, picture] = images(pkg);
  expect(group.anchor).toMatchObject({ locked: true, wrap: 'none', behind: true, x: 0, y: 228600 });
  expect(group.decorative).toBe(true); expect(picture.decorative).toBe(false);
  const scene = pkg.assets[group.assetId].scene.children[0];
  expect(scene.children.map(n => n.type)).toEqual(['picture', 'shape', 'shape']);
  expect(scene.children[1]).toMatchObject({ fill: '#24A890', outline: null, text: null });
  expect(scene.children[2]).toMatchObject({ fill: null, outline: null, text: null });
  retained(await save(pkg, model(pkg)), pkg.parts);
});

it('keeps a locked anchor on its source paragraph as earlier text grows and preserves its full XML', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), host = doc.paragraphs.find(p => p.runs.some(r => r.image?.anchor));
  const before = layout(doc).floatingObjects[0], shell = images(doc)[0].shell;
  doc.select(0); doc.replace('Extra line\n');
  const after = layout(doc).floatingObjects[0];
  expect(after.y).toBeGreaterThan(before.y); expect(after.x).toBe(before.x);
  expect(doc.paragraphs.find(p => p.runs.some(r => r.image?.anchor)).id).toBe(host.id);
  const exported = await save(pkg, doc), reopened = await DocxPackage.open(exported);
  expect(images(reopened)[0].shell).toContain('locked="1"'); expect(images(reopened)[0].decorative).toBe(true);
  expect(images(doc)[0].shell).toBe(shell); expect(model(reopened).text).toBe(doc.text);
  expectBodyEditParts(unzipSync(exported), pkg.parts); doc.undo(); retained(await save(pkg, doc), pkg.parts);
});

it('retains metadata through picture property edits, drawing deletion, undo and redo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), at = doc.text.lastIndexOf('\ufffc');
  doc.select(at, at + 1); doc.setImageProperties({ width: 685800, height: 685800, alt: 'New description' });
  const reopened = await DocxPackage.open(await save(pkg, doc)), pic = images(reopened)[1];
  expect(pic).toMatchObject({ width: 685800, alt: 'New description', decorative: false });
  expect(pic.shell).toContain('decorative'); expect(pic.shell).toContain('val="1"');
  doc.select(doc.text.indexOf('\ufffc'), doc.text.indexOf('\ufffc') + 1); doc.replace('');
  expect(images(await DocxPackage.open(await save(pkg, doc)))).toHaveLength(1);
  doc.undo(); expect(images(doc)).toHaveLength(2); doc.redo(); expect(images(doc)).toHaveLength(1);
  while (doc.history.length) doc.undo(); retained(await save(pkg, doc), pkg.parts);
});

it.each(['0', '1', 'false', 'true'])('accepts valid anchor-lock spellings (%s) without changing geometry', async value => {
  const a = model(await DocxPackage.open(source));
  const b = model(await DocxPackage.open(changed(x => node(x, WP, 'anchor').setAttribute('locked', value))));
  const geometry = d => layout(d).floatingObjects.map(f => [f.x, f.y, f.width, f.height]);
  expect(geometry(b)).toEqual(geometry(a));
  expect(images(b)[0].anchor.locked || false).toBe(['1', 'true'].includes(value));
});

it('preserves an omitted decorative value without inventing a boolean default', async () => {
  const data = changed(x => node(x, DEC, 'decorative').removeAttribute('val'));
  const pkg = await DocxPackage.open(data), doc = model(pkg);
  expect(images(doc)[0].decorative).toBeUndefined();
  doc.select(0); doc.replace('Edited ');
  const reopened = await DocxPackage.open(await save(pkg, doc));
  expect(images(reopened)[0].decorative).toBeUndefined();
  const xml = new DOMParser().parseFromString(images(reopened)[0].shell, 'application/xml');
  expect(node(xml, DEC, 'decorative').hasAttribute('val')).toBe(false);
});

it('retains explicit shape spacing flags and theme text while resolving the text body', async () => {
  function text(x, compatible, themed) {
    const shape = node(x, WPS, 'wsp'), body = node(shape, WPS, 'bodyPr');
    if (!themed) node(shape, WPS, 'style').remove();
    body.setAttribute('compatLnSpc', compatible);
    const box = x.createElementNS(WPS, 'wps:txbx'), content = x.createElementNS(W, 'w:txbxContent');
    content.append(node(x, W, 'p').cloneNode(true)); box.append(content); shape.insertBefore(box, body);
  }
  const pkg = await DocxPackage.open(changed(x => text(x, 'false', false)));
  const scene = pkg.assets[images(pkg)[0].assetId].scene.children[0].children[1];
  expect(scene.text.paragraphs[0].runs[0].text).toBe('Artwork metadata Á😀');
  for (const [compatible, themed] of [['true', false], ['false', true]]) {
    const opened = await DocxPackage.open(changed(x => text(x, compatible, themed)));
    const shape = opened.assets[images(opened)[0].assetId].scene.children[0].children[1];
    expect(shape.text.paragraphs[0].runs[0].text).toBe('Artwork metadata Á😀');
    const output = unzipSync(await save(opened, model(opened)));
    for (const [name, bytes] of Object.entries(opened.parts)) expect(Buffer.from(output[name]).equals(Buffer.from(bytes)), name).toBe(true);
  }
  await expect(DocxPackage.open(changed(x => text(x, 'yes', false)))).rejects.toThrow(/compatLnSpc/);
});

it.each([
  ['fill', 'solidFill', { fill: '#4F81BD', outline: null }],
  ['outline', 'ln', { fill: '#24A890', outline: { color: '#385D8A', width: 25400 } }],
])('resolves an active solid theme %s while preserving metadata and the original style reference', async (_, property, expected) => {
  const data = changed(x => node(x, WPS, 'spPr').removeChild(node(node(x, WPS, 'spPr'), A, property)));
  const pkg = await DocxPackage.open(data), doc = model(pkg);
  const shape = pkg.assets[images(pkg)[0].assetId].scene.children[0].children[1];
  expect(shape).toMatchObject(expected);
  expect(images(pkg)[0].decorative).toBe(true);
  retained(await save(pkg, doc), pkg.parts);
  doc.select(0); doc.replace('Edited ');
  const exported = await save(pkg, doc), reopened = await DocxPackage.open(exported);
  expect(reopened.assets[images(reopened)[0].assetId].scene.children[0].children[1]).toMatchObject(expected);
  expectBodyEditParts(unzipSync(exported), pkg.parts);
  doc.undo(); retained(await save(pkg, doc), pkg.parts);
});

it.each([
  ['invalid anchor flag', x => node(x, WP, 'anchor').setAttribute('locked', 'yes')],
  ['missing anchor flag', x => node(x, WP, 'anchor').removeAttribute('locked')],
  ['invalid decorative flag', x => node(x, DEC, 'decorative').setAttribute('val', 'yes')],
  ['unknown decorative attribute', x => node(x, DEC, 'decorative').setAttribute('other', '1')],
  ['unexpected metadata text', x => node(x, DEC, 'decorative').append('not a flag')],
  ['unknown extension attribute', x => node(x, A, 'ext').setAttribute('other', '1')],
  ['unknown nonvisual extension', x => node(x, A, 'ext').setAttribute('uri', 'urn:other')],
  ['wrong decorative namespace', x => { const n = node(x, DEC, 'decorative'); n.replaceWith(x.createElementNS('urn:wrong', 'bad:decorative')); }],
  ['duplicate metadata', x => { const n = node(x, A, 'ext'); n.parentElement.append(n.cloneNode(true)); }],
  ['duplicate metadata lists', x => { const n = node(x, A, 'extLst'); n.parentElement.append(n.cloneNode(true)); }],
  ['picture metadata hyperlinks', x => node(x, PIC, 'cNvPr').append(x.createElementNS(A, 'a:hlinkClick'))],
  ['invalid hidden group flag', x => node(x, WPG, 'cNvPr').setAttribute('hidden', 'yes')],
  ['missing theme effect index', x => node(x, A, 'effectRef').setAttribute('idx', '999')],
  ['missing reference', x => node(x, A, 'fillRef').remove()],
  ['invalid style color', x => node(x, A, 'schemeClr').setAttribute('val', 'bad')],
  ['invalid style transform', x => node(x, A, 'shade').setAttribute('val', '-1')],
  ['invalid style index', x => node(x, A, 'lnRef').setAttribute('idx', '-1')],
  ['warped body', x => node(x, A, 'prstTxWarp').setAttribute('prst', 'textArchUp')],
  ['rotated body', x => node(x, WPS, 'bodyPr').setAttribute('rot', '60000')],
  ['multiple text columns', x => node(x, WPS, 'bodyPr').setAttribute('numCol', '2')],
])('rejects %s before returning an editable document', async (_, change) => {
  await expect(DocxPackage.open(changed(change))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});

it('preserves supported hidden groups and theme effects through editing and undo', async () => {
  for (const [change, verify] of [
    [x => node(x, WPG, 'cNvPr').setAttribute('hidden', '1'), scene => expect(scene.children).toEqual([])],
    [x => node(x, A, 'effectRef').setAttribute('idx', '1'), scene => expect(scene.children[1].shadow).toBeDefined()],
  ]) {
    const pkg = await DocxPackage.open(changed(change)), doc = model(pkg);
    const scene = p => p.assets[images(p)[0].assetId].scene.children[0];
    verify(scene(pkg)); retained(await save(pkg, doc), pkg.parts);
    doc.select(0); doc.replace('Edited ');
    const exported = await save(pkg, doc), reopened = await DocxPackage.open(exported);
    expect(scene(reopened)).toEqual(scene(pkg)); expectBodyEditParts(unzipSync(exported), pkg.parts);
    doc.undo(); retained(await save(pkg, doc), pkg.parts);
  }
});
