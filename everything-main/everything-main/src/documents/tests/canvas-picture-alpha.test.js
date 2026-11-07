import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source = readFileSync('public/fixtures/picture-alpha.docx');
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const pictures = p => p.paragraphs.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
it('composes modifiers per picture while sharing immutable source pixels and retaining original effect metadata', async () => {
  const pkg = await DocxPackage.open(source);
  expect(pictures(pkg).map(i => i.opacity ?? 1)).toEqual([1,1,0,.00001,.5,.9,1,1,1,1,.5,.25,.5,.5,.9]);
  expect(Object.keys(pkg.assets)).toEqual(['word/media/main.png']);
  const d = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  const original = unzipSync(source);
  expect(unzipSync(await save())).toEqual(original);
  d.select(0); d.replace('Edited ');
  d.select(d.text.indexOf('\ufffc'), d.text.indexOf('\ufffc') + 1); d.setImageProperties({ alt: 'Updated alternative text' });
  const edited = await save(), reopened = await DocxPackage.open(edited);
  expect(pictures(reopened).map(i => i.opacity ?? 1)).toEqual(pictures(pkg).map(i => i.opacity ?? 1));
  expect(pictures(reopened).at(-1).shell).toContain('brightnessContrast');
  const out = unzipSync(edited); for (const key of Object.keys(original)) if (key !== 'word/document.xml') expect(out[key], key).toEqual(original[key]);
  d.undo(); d.undo(); expect(unzipSync(await save())).toEqual(original);
});
it.each(['-1','1.5','','NaN','2147483648','-10%','1e2%','+50%','.5%'])('rejects malformed alpha %s', async value => {
  const parts = unzipSync(source); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('amt="90000"', `amt="${value}"`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/alpha/);
});
it('guards unknown effects and duplicate extension lists', async () => {
  for (const mutate of [s => s.replace('<a:alphaModFix/>','<a:alphaRepl a="50000"/>'), s => s.replace('</a:extLst>','</a:extLst><a:extLst/>')]) {
    const parts = unzipSync(source); parts['word/document.xml'] = strToU8(mutate(strFromU8(parts['word/document.xml'])));
    await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/pictures/);
  }
});
