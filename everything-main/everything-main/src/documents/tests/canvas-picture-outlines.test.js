import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/picture-outlines.docx');
const scenes = p => Object.values(p.assets).filter(a => a.scene).map(a => a.scene);
const walk = n => [n, ...(n.children || []).flatMap(walk)];
it('keeps picture alpha and path flags separate from physical outline paint through edit and undo', async () => {
  const pkg = await DocxPackage.open(source), before = scenes(pkg), nodes = before.flatMap(walk);
  const pictures = nodes.filter(n => n.type === 'picture'), outlines = nodes.filter(n => n.outline);
  expect(pictures).toHaveLength(12); expect(outlines).toHaveLength(12);
  expect(outlines.every(n => n.outline.width === 38100 && n.outline.color === '#C020D0' && n.fill === null)).toBe(true);
  expect(pictures[11].image.opacity).toBe(.5); expect(outlines[11].opacity).toBeUndefined();
  expect(outlines[2].flipH).toBe(true); expect(outlines[6].outline.dash).toBe('dash');
  expect(outlines[9].paths.map(p => [p.fill,p.stroke])).toEqual([[false,true],[true,false]]);
  const doc = new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(pkg.parts);
  doc.select(0); doc.replace('Edited '); const edited = await save();
  expect(scenes(await DocxPackage.open(edited))).toEqual(before);
  for (const [name,bytes] of Object.entries(unzipSync(edited))) if(name!=='word/document.xml') expect(bytes).toEqual(pkg.parts[name]);
  doc.undo(); expect(unzipSync(await save())).toEqual(pkg.parts);
});
it.each([
  ['cap="rnd"','cap="invalid"'], ['w="38100"','w="-1"'],
])('rejects unsupported or malformed outline metadata %s', async (from,to) => {
  const parts=unzipSync(source), xml=strFromU8(parts['word/document.xml']);expect(xml).toContain(from);
  parts['word/document.xml']=strToU8(xml.replace(from,to));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('keeps unimplemented sketch types guarded', async () => {
  const parts = unzipSync(readFileSync('public/fixtures/picture-sketch-outlines.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('lineSketchCurved', 'lineSketchFreehand'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
