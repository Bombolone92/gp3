import { it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/hidden-line-controls.docx');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const parse = data => new DOMParser().parseFromString(strFromU8(unzipSync(data)['word/document.xml']), 'application/xml');
const lines = xml => [...xml.getElementsByTagNameNS(A14, 'hiddenLine')];
function change(fn = () => {}) {
  const parts = unzipSync(source), xml = parse(source), body = xml.documentElement.firstElementChild;
  // Retain the first six independently authored reference controls. The last two
  // have visible raster outlines, covered separately with the full source below.
  [...body.children].slice(12, 16).forEach(n => n.remove());
  fn(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const scenes = p => JSON.parse(JSON.stringify(Object.values(p.assets).filter(a => a.scene).map(a => a.scene), (k, v) => ['id', 'shell'].includes(k) ? undefined : v));
const signature = data => lines(parse(data)).map(n => new XMLSerializer().serializeToString(n));
it('retains the same visible scenes with or without saved outlines', async () => {
  const p = await DocxPackage.open(change()), plain = await DocxPackage.open(change(xml => lines(xml).forEach(n => n.parentNode.parentNode.remove())));
  expect(p.readOnly).not.toBe(true); expect(scenes(p)).toEqual(scenes(plain));
  expect(p.paragraphs.flatMap(p => p.runs).filter(r => r.image)).toHaveLength(6);
});
it('preserves saved outlines through image transforms, adjacent editing, reopening and exact undo', async () => {
  const bytes = change(), p = await DocxPackage.open(bytes), d = model(p);
  expect(unzipSync(await save(p, d))).toEqual(unzipSync(bytes));
  d.select(0); d.replace('Edited ');
  const at = d.text.lastIndexOf('\ufffc'); d.select(at, at + 1);
  d.setImageProperties({ width: d.selectedImage.width * 1.2, height: d.selectedImage.height * 1.2, flipH: true });
  const edited = await save(p, d), reopened = model(await DocxPackage.open(edited));
  expect(reopened.text).toBe(d.text); expect(signature(edited)).toEqual(signature(bytes));
  const parts = unzipSync(edited); for (const [name, data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(data)), name).toBe(true);
  while (d.history.length) d.undo(); expect(unzipSync(await save(p, d))).toEqual(unzipSync(bytes));
});
it.each(['0', '-0', '+127000', ' 20116800 '])('accepts saved outline width %s without applying it to visible outlines', async w => {
  const p = await DocxPackage.open(change(xml => lines(xml).forEach(n => n.setAttribute('w', w))));
  expect(scenes(p)).toEqual(scenes(await DocxPackage.open(change())));
});
it.each(['width', 'cap', 'compound', 'alignment', 'attribute', 'duplicate', 'namespace', 'child', 'order', 'text'])('rejects malformed saved outline containers: %s', async kind => {
  const bytes = change(xml => {
    const n = lines(xml)[0];
    if (kind === 'width') n.setAttribute('w', '20116801');
    if (kind === 'cap') n.setAttribute('cap', 'future');
    if (kind === 'compound') n.setAttribute('cmpd', 'future');
    if (kind === 'alignment') n.setAttribute('algn', 'future');
    if (kind === 'attribute') n.setAttribute('future', '1');
    if (kind === 'duplicate') n.parentNode.append(n.cloneNode(true));
    if (kind === 'namespace') n.replaceWith(xml.createElementNS(A, 'a:hiddenLine'));
    if (kind === 'child') n.append(xml.createElementNS(A, 'a:future'));
    if (kind === 'order') n.append(n.firstElementChild.cloneNode(true));
    if (kind === 'text') n.append(xml.createTextNode('invalid'));
  });
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
});
it('keeps saved hidden outlines inactive alongside supported visible picture outlines', async () => {
  const p = await DocxPackage.open(source), parts = unzipSync(source), xml = parse(source);
  lines(xml).forEach(n => n.parentNode.parentNode.remove());
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const plain = await DocxPackage.open(zipSync(parts));
  expect(p.readOnly).not.toBe(true);
  expect(p.paragraphs.flatMap(p => p.runs).filter(r => r.image)).toHaveLength(8);
  expect(scenes(p)).toEqual(scenes(plain));
  const walk = n => [n, ...(n.children || []).flatMap(walk)];
  expect(scenes(p).flatMap(walk).filter(n => n.pictureOutline)).toHaveLength(2);
  expect(unzipSync(await save(p, model(p)))).toEqual(p.parts);
});
it('coexists with shadow flags on nested grouped pictures and shapes', async () => {
  const original = readFileSync('public/fixtures/shadow-obscured.docx'), parts = unzipSync(original), xml = parse(original);
  for (const flag of [...xml.getElementsByTagNameNS(A14, 'shadowObscured')]) {
    const ext = xml.createElementNS(A, 'a:ext'); ext.setAttribute('uri', '{91240B29-F687-4F45-9708-019B960494DF}');
    const line = xml.createElementNS(A14, 'a14:hiddenLine'); line.setAttribute('w', '127000'); ext.append(line); flag.parentNode.parentNode.append(ext);
  }
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  const bytes = zipSync(parts), p = await DocxPackage.open(bytes), d = model(p);
  expect(scenes(p)).toEqual(scenes(await DocxPackage.open(original)));
  d.select(0); d.replace('Edited '); expect(signature(await save(p, d))).toEqual(signature(bytes));
});
it('preserves dormant gradients and arrowheads without requiring active outline support', async () => {
  const bytes = change(xml => {
    const n = lines(xml)[0]; n.replaceChildren(); n.setAttribute('cmpd', 'tri'); n.setAttribute('algn', 'in');
    const fragment = new DOMParser().parseFromString(`<a:root xmlns:a="${A}"><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill><a:headEnd type="triangle" w="lg" len="sm"/></a:root>`, 'application/xml');
    for (const child of [...fragment.documentElement.children]) n.append(xml.importNode(child, true));
  });
  const p = await DocxPackage.open(bytes), d = model(p);
  expect(scenes(p)).toEqual(scenes(await DocxPackage.open(change())));
  d.select(0); d.replace('Edited '); expect(signature(await save(p, d))).toEqual(signature(bytes));
});
