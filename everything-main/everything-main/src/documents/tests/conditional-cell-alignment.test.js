import {beforeAll, afterAll, it, expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const folder = 'tests/fixtures/conditional-cell-alignment';
const references = JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
it('retains independent native source and reference hashes', () => {
  for (const ref of Object.values(references)) for (const [name, hash] of Object.entries(ref.hashes))
    expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(hash);
});
for (const mode of [12, 14, 15]) it(`mode ${mode}: resolves alignment and preserves styles through direct edits, topology edits and exact undo`, async () => {
  const source = readFileSync(`${folder}/mode${mode}.docx`), pkg = await DocxPackage.open(source);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  expect(pkg.readOnly).toBeFalsy();
  expect(doc.tables.map(t => t.rows[0].cells[1].vertical)).toEqual(mode >= 15
    ? ['bottom', 'center', 'bottom', 'bottom', 'center', 'center', 'center', 'center', 'center']
    : ['bottom', 'bottom', 'top', 'bottom', 'center', 'bottom', 'center', 'bottom', 'bottom']);
  expect(doc.tables[7].rows[0].cells[0].vertical).toBe('top');
  expect(doc.tables[8].rows[0].cells[0].vertical).toBe('bottom');
  doc.selectCell(doc.tables[1].rows[0].cells[0].id); doc.setCellVerticalAlignment('top');
  const edited = unzipSync(await save()), original = unzipSync(source), reopened = await DocxPackage.open(await save());
  expect(reopened.tables[1].rows[0].cells[0].vertical).toBe('top');
  expect(reopened.tables[1].rows[0].cells[1].vertical).toBe(mode >= 15 ? 'center' : 'bottom');
  for (const name of Object.keys(original)) if (name !== 'word/document.xml')
    expect(Buffer.from(edited[name]).equals(Buffer.from(original[name])), name).toBe(true);
  doc.undo(); doc.selectCell(doc.tables[1].rows[0].cells[0].id); doc.insertTableColumn();
  const topology = await DocxPackage.open(await save());
  expect(topology.tables[1].rows[0].cells.map(c => c.vertical)).toEqual(Array(3).fill(mode >= 15 ? 'center' : 'bottom'));
  doc.undo(); const undo = unzipSync(await save());
  for (const name of Object.keys(original)) expect(Buffer.from(undo[name]).equals(Buffer.from(original[name])), name).toBe(true);
});
