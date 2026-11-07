import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
for (const name of ['shifted-inline-leading']) it(`preserves ${name} through adjacent text editing, reopening and undo`, async () => {
  const source = readFileSync('tests/fixtures/shifted-inline-leading/controls.docx'), parts = unzipSync(source);
  const pkg = await DocxPackage.open(source), model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const original = model.text, images = ps => ps.flatMap(p => p.runs.filter(r => r.image).map(r => r.image));
  const initialImages = images(model.paragraphs);
  const save = async () => new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets).arrayBuffer());
  const same = (data, edited = false) => {
    const actual = unzipSync(data); expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());
    if (edited) return expectBodyEditParts(actual, parts);
    for (const path of Object.keys(parts)) expect(Buffer.from(actual[path]).equals(Buffer.from(parts[path])), path).toBe(true);
  };
  same(await save());
  model.select(0); model.replace('Edited ');
  const edited = await save(); same(edited, true);
  const reopened = await DocxPackage.open(edited);
  expect(new TextDocument(reopened.paragraphs,reopened.pageSettings,reopened.numbering,reopened.styles,reopened.tables,reopened.assets).text).toBe('Edited ' + original);
  expect(images(reopened.paragraphs)).toEqual(initialImages);
  const shifts=ps=>ps.flatMap(p=>p.runs.map(r=>r.baselineShift));
  expect(shifts(reopened.paragraphs)).toEqual(shifts(model.paragraphs));
  model.undo(); expect(model.text).toBe(original); same(await save());
});
