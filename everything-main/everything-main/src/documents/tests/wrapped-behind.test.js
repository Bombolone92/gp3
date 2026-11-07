import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = () => readFileSync('tests/fixtures/wrapped-behind/control.docx');
it('retains wrapped behind-text pictures and page/margin coordinates through editing', async () => {
  const pkg = await DocxPackage.open(source());
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const images = () => doc.paragraphs.flatMap(p => p.runs).filter(r => r.image).map(r => r.image);
  expect(images().filter((_, i) => i % 2 === 0).map(i => i.anchor.behind)).toEqual([false,true,false,true,false,true,false,true]);
  const placed = layoutDocument(doc.paragraphs, (text, style) => ({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize/3}), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
  expect(placed.pageCount).toBe(8);
  for (const frame of placed.floatingObjects) {
    expect(frame.x * .75).toBeCloseTo(frame.image.anchor.order === 0 ? 72 : 90);
    expect(frame.y * .75).toBeCloseTo(86);
  }
  const save = async () => unzipSync(new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer()));
  expect(await save()).toEqual(pkg.parts);
  doc.select(0); doc.replace('Edited ');
  const edited = await save(), reopened = await DocxPackage.open(zipSync(edited));
  expect(reopened.paragraphs.flatMap(p => p.runs).filter(r => r.image).map(r => r.image.anchor)).toEqual(images().map(i => i.anchor));
  for (const name of Object.keys(pkg.parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(pkg.parts[name]);
  doc.undo(); expect(await save()).toEqual(pkg.parts);
});
it('continues rejecting invalid behindDoc boolean values', async () => {
  const parts = unzipSync(source());
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('behindDoc="0"', 'behindDoc="maybe"'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/behindDoc/);
});
