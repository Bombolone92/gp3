import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
for (const name of ['inline-object-baseline', 'inline-object-edge', 'inline-object-edge-modern', 'inline-object-edge-legacy14', 'inline-object-exact', 'inline-object-advance']) it(`preserves ${name} through adjacent text editing, reopening and undo`, async () => {
  const source = readFileSync(`public/fixtures/${name}.docx`), parts = unzipSync(source);
  const pkg = await DocxPackage.open(source), model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const original = model.text, images = ps => ps.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
  const initialImages = images(model.paragraphs);
  const save = async () => new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets).arrayBuffer());
  const same = (data, edited = false) => {
    const actual = unzipSync(data); expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());
    for (const path of Object.keys(parts)) if (!edited || path !== 'word/document.xml') expect(Buffer.from(actual[path]).equals(Buffer.from(parts[path])), path).toBe(true);
  };
  same(await save());
  model.select(0); model.replace('Edited ');
  const edited = await save(); same(edited, true);
  const reopened = await DocxPackage.open(edited);
  expect(new TextDocument(reopened.paragraphs).text).toBe('Edited ' + original);
  expect(images(reopened.paragraphs)).toEqual(initialImages);
  model.undo(); expect(model.text).toBe(original); same(await save());
});
