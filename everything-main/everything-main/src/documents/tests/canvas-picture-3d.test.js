import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('public/fixtures/picture-3d.docx');
const scenes = p => Object.values(p.assets).filter(a => a.scene).map(a => a.scene);
it('retains independent 3D pictures through surrounding edits, reopen and exact undo', async () => {
  const p = await DocxPackage.open(source), before = scenes(p);
  expect(before).toHaveLength(13);
  expect(before[3]).toMatchObject({ type: 'picture3d', geometry: 'ellipse', depth: 20, contour: 4.5, contourColor: '202060' });
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
  const at = d.text.indexOf('\ufffc'); d.select(at, at + 1);
  for (const patch of [{ width: 914400 }, { flipH: true }, { rotation: 5400000 }]) expect(() => d.setImageProperties(patch)).toThrow(/retained as complete objects/);
  const save = async () => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  d.select(0); d.replace('Edited ');
  expect(scenes(await DocxPackage.open(await save()))).toEqual(before);
  d.undo(); expect(unzipSync(await save())).toEqual(p.parts);
}, 30000); // Full thirteen-picture import, edit/export/reopen and exact undo.
it.each([
  ['prst="perspectiveRight"', 'prst="perspectiveAbove"'],
  ['rig="threePt"', 'rig="balanced"'],
  ['dir="t"', 'dir="b"'],
  ['extrusionH="0"', 'extrusionH="-1"'],
  ['contourW="0"', 'contourW="NaN"'],
  ['<a:sp3d ', '<a:sp3d prstMaterial="metal" '],
  ['<a:sp3d ', '<a:sp3d z="12700" '],
  ['<a:camera prst="orthographicFront"/>', '<a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="0"/></a:camera>'],
])('guards unsupported or malformed 3D data: %s', async (from, to) => {
  const parts = unzipSync(source), xml = strFromU8(parts['word/document.xml']); expect(xml).toContain(from);
  parts['word/document.xml'] = strToU8(xml.replace(from, to));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
