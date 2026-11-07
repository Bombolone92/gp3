import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/table-shading-scope.docx');
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('matches the native reference table/cell shading separation through edit, inherit, topology change, reopen and undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  const fills = () => doc.tables.map(t => t.rows[0].cells.map(c => c.fill));
  expect(fills()).toEqual([[null,null],[null,null],['#88CC99','#99BBEE'],[null,null],['#88CC99','#99BBEE']]);
  // Removing direct cell paint recovers the cell style, never the orange table.
  doc.selectCell(doc.tables[2].rows[0].cells[1].id); doc.setCellShading(null);
  expect(fills()[2]).toEqual(['#88CC99','#88CC99']);
  // Recompute conditional styles after inserting a row: the new row has no
  // first-row cell shading, and table orange must not leak back into it.
  doc.selectCell(doc.tables[4].rows[0].cells[0].id); doc.insertTableRow();
  expect(doc.tables[4].rows[1].cells[0].fill).toBeNull();
  const edited = await save(pkg,doc), reopened = await DocxPackage.open(edited);
  expect(reopened.tables.map(t => t.rows.map(r => r.cells.map(c => c.fill)))).toEqual(doc.tables.map(t => t.rows.map(r => r.cells.map(c => c.fill))));
  const originalParts = unzipSync(source), editedParts = unzipSync(edited);
  for (const name of Object.keys(originalParts)) if (name !== 'word/document.xml') expect(Buffer.from(editedParts[name]).equals(Buffer.from(originalParts[name])),name).toBe(true);
  doc.undo(); doc.undo(); const undone=unzipSync(await save(pkg,doc));
  for (const name of Object.keys(originalParts)) expect(Buffer.from(undone[name]).equals(Buffer.from(originalParts[name])),name).toBe(true);
});
