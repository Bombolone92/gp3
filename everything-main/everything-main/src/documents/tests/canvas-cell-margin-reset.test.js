import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/cell-margin-reset.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/cell-margin-reset/reference.json'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const right = [[480,480],[0,0],[360,360],[160,0],[480,0],[0,0],[240,240],[480,480],[480,0],[480,0],[480,480],[480,480],[480,480],[480,480],[300,300],[300,360],[180,180],[180,360],[360,360],[360,360],[160,480],[480,480]];
function check(d) {
  expect(d.tables).toHaveLength(right.length);
  expect(d.tables.map(t => t.rows.map(r => r.cells[0].margins.right))).toEqual(right);
  const layout = layoutDocument(d.paragraphs, t => ({ width: t.length * 9.6, ascent: 12, descent: 4 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
  expect(layout.pageCount).toBe(22);
  for (const [page, lines] of reference.pages.entries()) for (const expected of lines) {
    const actual = layout.lines.find(l => l.fragments.map(f => f.text).join('') === expected.text);
    expect(actual.page, expected.text).toBe(page);
    expect(Math.abs(actual.fragments[0].x * .75 - expected.x), expected.text).toBeLessThan(.15);
  }
}
it('matches the native reference table/default, cell, conditional, row and derived-style margin precedence', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); check(doc);
  const out = unzipSync(await save(pkg, doc));
  for (const [name, bytes] of Object.entries(pkg.parts)) expect(Buffer.from(out[name]).equals(Buffer.from(bytes)), name).toBe(true);
});
it('retains unedited reset sides through margin edits, reimport, topology refresh and exact undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  const cell = doc.tables[17].rows[0].cells[0]; doc.selectCell(cell.id);
  const before = doc.snapshot();
  doc.setCellMargins({left: 400}); expect(cell.margins.right).toBe(180);
  let reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables[17].rows[0].cells[0].margins).toMatchObject({left:400,right:180});
  doc.undo(); expect(doc.snapshot()).toEqual(before); check(doc);
  doc.insertTableRow();
  expect(doc.tables[17].rows.map(r => r.cells[0].margins.right)).toEqual([180,360,360]);
  doc.undo(); check(doc);
  doc.selectCell(doc.tables[7].rows[0].cells[0].id); doc.setCellMargins({right:null});
  expect(doc.tables[7].rows[0].cells[0].margins.right).toBe(360);
  reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.tables[7].rows[0].cells[0].margins.right).toBe(360);
  doc.undo(); check(doc);
  const bytes = unzipSync(await save(pkg,doc));
  for (const [name, original] of Object.entries(pkg.parts)) expect(Buffer.from(bytes[name]).equals(Buffer.from(original)), name).toBe(true);
});
