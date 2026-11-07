import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { drawingLineDash, DRAWING_DASHES } from '../src/engine/drawing-line-dashes.js';
const source = readFileSync('public/fixtures/drawing-line-caps.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const outlines = pkg => {
  const result = [];
  const walk = node => node.type === 'group' ? node.children.forEach(walk) : result.push(node.outline);
  Object.values(pkg.assets).forEach(a => walk(a.scene)); return result;
};
it('imports all cap styles and preserves drawing XML through editing, reopening and undo', async () => {
  const pkg = await DocxPackage.open(source), before = outlines(pkg);
  expect(before.map(n => n.cap || 'flat')).toEqual(Array.from({ length: 22 }, (_, i) => ['flat', 'rnd', 'sq', 'flat'][i % 4]));
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0); doc.replace('Edited '); const edited = await save();
  expect(outlines(await DocxPackage.open(edited))).toEqual(before);
  const parts = unzipSync(source), editedParts = unzipSync(edited);
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(editedParts[name], name).toEqual(parts[name]);
  doc.undo(); expect(unzipSync(await save())).toEqual(parts);
});
it.each(['round', '', '1'])('rejects invalid cap %s', async value => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('cap="rnd"', `cap="${value}"`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/invalid outline cap/);
});
it('imports round caps on double strokes and preserves the drawing declaration', async () => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('cap="rnd"', 'cap="rnd" cmpd="dbl"'));
  const original=outlines(await DocxPackage.open(source)),pkg=await DocxPackage.open(zipSync(parts));
  original[1]={...original[1],compound:'dbl'};
  expect(outlines(pkg)).toEqual(original);
  const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const output=new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  expect(unzipSync(output)).toEqual(parts);
});
it.each(['invalid','','1'])('rejects invalid compound stroke %s', async value => {
  const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('cap="rnd"',`cap="rnd" cmpd="${value}"`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/invalid compound outline/);
});
it('compensates extending caps without mutating preset arrays or their periods', () => {
  for (const [name, lengths] of Object.entries(DRAWING_DASHES)) {
    expect(drawingLineDash(name)).toEqual(lengths);
    for (const cap of ['rnd', 'sq']) {
      const actual = drawingLineDash(name, cap);
      expect(actual.every(n => n >= 0)).toBe(true);
      expect(actual.reduce((sum, n) => sum + n, 0)).toBe(lengths.reduce((sum, n) => sum + n, 0));
    }
  }
  expect(drawingLineDash('dot', 'rnd')).toEqual([0, 4]);
  expect(drawingLineDash('dashDot', 'sq')).toEqual([3, 4, 0, 4]);
  expect(DRAWING_DASHES.dot).toEqual([1, 3]);
});
