import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { cellIntrinsicWidths } from '../src/engine/intrinsic-widths.js';
import { autoColumnWidths } from '../src/engine/tables.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/table-no-wrap.docx');
const measure = text => ({ width: text.length * 8, ascent: 12, descent: 4 });
function changed(change) {
  const parts = unzipSync(source);
  const doc = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const styles = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
  change(doc, styles);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(doc));
  parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(styles));
  return zipSync(parts);
}
it('retains noWrap declarations across host edits, new rows, reopen and exact undo', async () => {
  const p = await DocxPackage.open(source), d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables);
  const save = async () => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables).arrayBuffer());
  expect(p.tables.slice(0, 12).map(t => t.rows[0].cells[0].noWrap)).toEqual(Array.from({ length: 12 }, (_, i) => !!(i % 2)));
  d.selectCell(d.tables[1].rows[0].cells[0].id); d.insertTableRow(); d.replace('Inserted text');
  // New cells can be serialized without a retained tcPr shell.
  delete d.tableContext.row.cells[0].shell;
  const out = await save(), reopened = await DocxPackage.open(out);
  expect(reopened.tables[1].rows).toHaveLength(2);
  expect(reopened.tables[1].rows.every(r => r.cells[0].noWrap)).toBe(true);
  for (const [name, bytes] of Object.entries(unzipSync(out))) if (name !== 'word/document.xml') expect(bytes).toEqual(p.parts[name]);
  while (d.history.length) d.undo();
  expect(unzipSync(await save())).toEqual(p.parts);
});
it('compresses whole intrinsic widths proportionally at the page limit, retaining hard floors', () => {
  const table = { grid: [1800, 1200], width: { type: 'dxa', value: 3000 }, rows: [{ cells: [{ width: { type: 'dxa', value: 1800 } }, { width: { type: 'dxa', value: 1200 } }] }] };
  const widths = autoColumnWidths(table, 4680, [{ min: 2000, max: 2000, floor: 100 }, { min: 4000, max: 4000, floor: 100 }]);
  expect(widths[0]).toBeCloseTo(1560); expect(widths[1]).toBeCloseTo(3120);
  const constrained = autoColumnWidths(table, 4680, [{ min: 2000, max: 2000, floor: 1900 }, { min: 4000, max: 4000, floor: 100 }]);
  expect(constrained[0]).toBeGreaterThanOrEqual(1900);
  expect(constrained.reduce((a, b) => a + b, 0)).toBeCloseTo(4680);
});
it('measures unbroken explicit lines for auto/pct and protects absolute preferences without changing grapheme floors', () => {
  const cell = { noWrap: true, margins: { left: 0, right: 0 }, content: [{ paragraph: paragraph('aa bb\vcccc'), index: 0 }] };
  const metrics = (width, autoFit = true) => cellIntrinsicWidths({ ...cell, width }, measure, {}, undefined, [], undefined, autoFit);
  for (const type of ['auto', 'pct', 'nil']) {
    expect(metrics({ type, value: 0 }).min).toBe(40);
    expect(metrics({ type, value: 0 }).floor).toBe(8);
  }
  expect(metrics({ type: 'dxa', value: 1440 }).min).toBeCloseTo(1456 / 15);
  expect(metrics({ type: 'dxa', value: 1440 }, false).min).toBe(32);
});
it.each(['0', 'false', 'off', '1', 'true', 'on'])('reads explicit noWrap=%s without normalizing retained XML', async value => {
  const p = await DocxPackage.open(changed(doc => doc.getElementsByTagNameNS(W, 'noWrap')[0].setAttributeNS(W, 'w:val', value)));
  expect(p.tables[0].rows[0].cells[0].noWrap).toBe(['1', 'true', 'on'].includes(value));
});
it.each(['invalid', 'child', 'attribute', 'duplicate'])('rejects malformed noWrap %s', async kind => {
  await expect(DocxPackage.open(changed(doc => {
    const n = doc.getElementsByTagNameNS(W, 'noWrap')[0];
    if (kind === 'invalid') n.setAttributeNS(W, 'w:val', 'maybe');
    if (kind === 'child') n.appendChild(doc.createElementNS(W, 'w:foo'));
    if (kind === 'attribute') n.setAttribute('unknown', '1');
    if (kind === 'duplicate') n.parentNode.appendChild(n.cloneNode(true));
  }))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
it('resolves whole-table and conditional noWrap with explicit false overriding inheritance', async () => {
  const input = changed((doc, styles) => {
    const parse = text => new DOMParser().parseFromString(`<root xmlns:w="${W}">${text}</root>`, 'application/xml').documentElement.firstElementChild;
    styles.documentElement.appendChild(styles.importNode(parse('<w:style w:type="table" w:styleId="Wrapping"><w:name w:val="Wrapping"/><w:tcPr><w:noWrap/></w:tcPr><w:tblStylePr w:type="firstRow"><w:tcPr><w:noWrap w:val="0"/></w:tcPr></w:tblStylePr></w:style>'), true));
    const tables = [...doc.getElementsByTagNameNS(W, 'tbl')];
    for (const [i, table] of tables.slice(0, 3).entries()) {
      const pr = table.getElementsByTagNameNS(W, 'tblPr')[0];
      pr.insertBefore(doc.importNode(parse('<w:tblStyle w:val="Wrapping"/>'), true), pr.firstChild);
      pr.appendChild(doc.importNode(parse(`<w:tblLook w:firstRow="${i === 2 ? 1 : 0}"/>`), true));
      if (i !== 0) table.getElementsByTagNameNS(W, 'noWrap')[0].remove();
    }
  });
  const p = await DocxPackage.open(input);
  expect(p.tables[1].conditionalStyle?.cell.noWrap).toBe(true);
  expect(p.tables[1].conditionalStyle?.settings.look.firstRow).toBe(false);
  expect(p.tables.slice(0, 3).map(t => t.rows[0].cells[0].noWrap)).toEqual([false, true, false]);
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables);
  d.selectCell(d.tables[0].rows[0].cells[0].id); d.replace('Replacement');
  delete d.tables[0].rows[0].cells[0].shell;
  const bytes = new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables).arrayBuffer());
  expect((await DocxPackage.open(bytes)).tables[0].rows[0].cells[0].noWrap).toBe(false);
});

it('keeps protected noWrap preferences separate from measured content and accounts for each margin edge', () => {
 const measure = text => ({width: text.length * 5, ascent: 8, descent: 2});
 for (const [left,right,allowance] of [[0,0,16],[1,0,8],[0,48,8],[8,8,0],[48,48,0]]) {
  const cell = {noWrap:true,width:{type:'dxa',value:2400},margins:{left,right},content:[{paragraph:paragraph('X'),index:0}]};
  const metrics = cellIntrinsicWidths(cell,measure,{left:0,defaultTabStop:720},undefined,[]);
  expect(metrics.min*15).toBeCloseTo(2400+allowance,8);
  expect(metrics.max*15).toBeCloseTo(75+left+right,8);
 }
});

it('shares total intrinsic border space across asymmetric margins without changing text inset placement',()=>{
 const measure=text=>({width:text.length*5,ascent:8,descent:2}),border={style:'single',size:4};
 for(const [left,right,total]of [[0,0,10],[8,0,10],[16,0,16],[0,16,16],[8,8,16],[48,48,96]]){
  const cell={noWrap:true,width:{type:'dxa',value:2400},margins:{left,right},content:[{paragraph:paragraph('X'),index:0}]};
  const m=cellIntrinsicWidths(cell,measure,{},undefined,[],{left:border,right:border});
  expect(m.max*15).toBeCloseTo(75+total,8);expect(m.min*15).toBeCloseTo(2400,8);
 }
});
