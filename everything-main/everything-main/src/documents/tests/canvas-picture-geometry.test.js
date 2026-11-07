import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/picture-geometry.docx');
const scenes = p => Object.values(p.assets).filter(a => a.scene).map(a => a.scene);
it('retains custom picture scenes and original paths through editing, reopening and exact undo', async () => {
  const p = await DocxPackage.open(source), before = scenes(p);
  expect(before).toHaveLength(12);
  const pictures = before.map(s => s.type === 'group' ? s.children[0].children[0] : s);
  expect(pictures.slice(0,9).every(s => s.clipPaths.length === 1)).toBe(true);
  expect(pictures.slice(9).every(s => s.clipPaths.length === 2)).toBe(true);
  expect(pictures[11].image.opacity).toBe(.5);
  expect(pictures[3].clipPaths[0].points.some(p => p[0] === 'C')).toBe(true);
  expect(pictures[4].clipPaths[0].points.filter(p => p[0] === 'M')).toHaveLength(2);
  expect(pictures[5].clipPaths[0].fill).toBe(false);
  expect(pictures[2].image.flipH).toBe(true);
  expect(pictures[6].image.crop.left).toBe(25000);
  const d = new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const save = async () => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(p.parts);
  d.select(0); d.replace('Edited '); const edited = await save();
  expect(scenes(await DocxPackage.open(edited))).toEqual(before);
  for (const [name,data] of Object.entries(unzipSync(edited))) if (name !== 'word/document.xml') expect(data).toEqual(p.parts[name]);
  d.undo(); expect(unzipSync(await save())).toEqual(p.parts);
});
it.each([
  ['fmla="*/ w 1 2"','fmla="unknown w"'],
  ['<a:path w="100"','<a:path w="0"'],
  ['<a:moveTo>','<a:arcTo>'],
  ['flipH="1"','rot="2147483648"'],
])('does not bypass malformed or unsupported geometry %s', async (before,after) => {
  const p = unzipSync(source);p['word/document.xml']=strToU8(strFromU8(p['word/document.xml']).replace(before,after));
  await expect(DocxPackage.open(zipSync(p))).rejects.toThrow();
});
