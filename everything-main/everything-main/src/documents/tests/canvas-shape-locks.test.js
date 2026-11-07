import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { A } from '../src/engine/docx-images.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source = readFileSync('public/fixtures/shape-locks.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const parse = bytes => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
const locks = xml => [...xml.getElementsByTagNameNS(A, 'spLocks')];
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const images = p => p.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
function changed(change) {
  const parts = unzipSync(source), xml = parse(parts['word/document.xml']);
  change(xml, locks(xml)[0]); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
function sameParts(bytes, parts, edited = false) {
  const out = unzipSync(bytes); expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());
  if (edited) { expectBodyEditParts(out, parts); return; }
  for (const [name, data] of Object.entries(parts)) expect(Buffer.from(out[name]).equals(Buffer.from(data)), name).toBe(true);
}
const lockValues = bytes => locks(parse(unzipSync(bytes)['word/document.xml'])).map(n => Object.fromEntries([...n.attributes].map(a => [a.name, a.value])));

it('preserves nested shape locks without changing the render scene, placement or dimensions', async () => {
  const p = await DocxPackage.open(source), bare = await DocxPackage.open(changed(xml => locks(xml).forEach(n => n.remove())));
  // Paragraph model IDs are allocated anew on each import, independently of XML.
  const scenes = p => images(p).map(i => JSON.parse(JSON.stringify(p.assets[i.assetId].scene, (key, value) => key === 'id' ? undefined : value)));
  expect(scenes(p)).toEqual(scenes(bare));
  for (const [i, image] of images(p).entries()) for (const key of ['width', 'height', 'anchor']) expect(image[key]).toEqual(images(bare)[i][key]);
  sameParts(await save(p, model(p)), p.parts);
});

it('honors transformation locks while allowing surrounding edits and atomic deletion/undo', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  const at = d.text.indexOf('\ufffc'); d.select(at, at + 1);
  for (const patch of [{ width: d.selectedImage.width * 2 }, { height: d.selectedImage.height * 2 }, { rotation: 5400000 }, { flipH: true }]) {
    expect(() => d.setImageProperties(patch)).toThrow(/complete objects/);
    expect(d.history).toHaveLength(0);
  }
  d.replace(''); expect(images(d)).toHaveLength(2); d.undo(); expect(images(d)).toHaveLength(3);
  sameParts(await save(p, d), p.parts);
  d.select(0); d.replace('Edited ');
  const bytes = await save(p, d), reopened = await DocxPackage.open(bytes);
  expect(model(reopened).text).toBe(d.text); expect(lockValues(bytes)).toEqual(lockValues(source));
  sameParts(bytes, p.parts, true); d.undo(); sameParts(await save(p, d), p.parts);
});

it.each([null, 'true', '1', 'false', '0', ' \ttrue\r\n'])('retains the XML Schema boolean spelling %s', async value => {
    const bytes = changed((xml, n) => { for (const attr of [...n.attributes]) n.removeAttributeNode(attr); if (value !== null) n.setAttribute('noChangeAspect', value); });
    const p = await DocxPackage.open(bytes); sameParts(await save(p, model(p)), p.parts);
});

it.each([
  ['invalid boolean', (xml, n) => n.setAttribute('noResize', 'yes')],
  ['empty boolean', (xml, n) => n.setAttribute('noMove', '')],
  ['non-XML whitespace', (xml, n) => n.setAttribute('noRot', '\u00a0true')],
  ['wrong boolean case', (xml, n) => n.setAttribute('noChangeAspect', 'True')],
  ['unknown lock', (xml, n) => n.setAttribute('noUngrp', '1')],
  ['qualified lock', (xml, n) => n.setAttributeNS(A, 'a:noResize', '1')],
  ['unexpected lock property', (xml, n) => n.setAttribute('unsupported', '1')],
  ['nested extension', (xml, n) => n.append(xml.createElementNS(A, 'a:extLst'))],
  ['text content', (xml, n) => n.append('invalid')],
  ['non-XML whitespace text', (xml, n) => n.append('\u00a0')],
  ['duplicate locks', (xml, n) => n.parentElement.append(n.cloneNode(true))],
  ['wrong namespace', (xml, n) => n.replaceWith(xml.createElementNS('urn:wrong', 'x:spLocks'))],
  ['selection prohibition', (xml, n) => n.setAttribute('noSelect', '1')],
  ['nested selection prohibition', xml => locks(xml)[1].setAttribute('noSelect', ' true ')],
])('rejects %s before editing', async (_, change) => {
  await expect(DocxPackage.open(changed(change))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
