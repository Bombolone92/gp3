import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,hitTest} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const source=readFileSync('tests/fixtures/nested-tables/nested-table-probe.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('reads nested cells in source order and preserves an inner text edit through export and undo',async()=>{
  const pkg=await DocxPackage.open(source),d=model(pkg);
  expect(d.tables).toHaveLength(2);
  expect(d.text).toBe('Nested table probe\nOuter before\nInner A1\nInner B1\nInner A2\nInner B2\nOuter after\nOuter side\nOuter lower left\nOuter lower right\nAfter outer table');
  d.select(d.text.indexOf('Inner A1')+5);d.replace('edited ');
  const bytes=await save(pkg,d),reopened=model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(d.text);expect(reopened.tables.filter(t=>t.parentCellId)).toHaveLength(1);
  const xml=new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');
  expect(xml.getElementsByTagNameNS('*','tbl')).toHaveLength(2);
  expect(xml.getElementsByTagNameNS('*','tbl')[1].parentElement.localName).toBe('tc');

  d.undo();const restored=unzipSync(await save(pkg,d));
  for(const [name,bytes] of Object.entries(unzipSync(source)))expect(Buffer.from(restored[name]).equals(Buffer.from(bytes))).toBe(true);
});
it('inserts an inner row without changing outer row structure',async()=>{
  const pkg=await DocxPackage.open(source),d=model(pkg);d.select(d.text.indexOf('Inner A1'));d.insertTableRow();
  const reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(reopened.tables.find(t=>t.parentCellId).rows).toHaveLength(3);
  expect(reopened.tables.find(t=>!t.parentCellId).rows).toHaveLength(2);
  expect(reopened.text).toBe(d.text);
});
it('preserves the inner table when inserting a row in the outer table',async()=>{
  const pkg=await DocxPackage.open(source),d=model(pkg);d.select(d.text.indexOf('Outer before'));d.insertTableRow();
  const reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(reopened.tables.find(t=>t.parentCellId).rows).toHaveLength(2);
  expect(reopened.tables.find(t=>!t.parentCellId).rows).toHaveLength(3);
  expect(reopened.text).toBe(d.text);
});
it('removes descendant tables when deleting their containing outer table',async()=>{
  const pkg=await DocxPackage.open(source),d=model(pkg);d.select(d.text.indexOf('Outer before'));d.deleteTablePart('table');
  const reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(reopened.tables).toHaveLength(0);
  expect(reopened.text).toBe('Nested table probe\nAfter outer table');
});
it('lays out the inner grid between the surrounding cell paragraphs and hit-tests its deepest cell',async()=>{
  const pkg=await DocxPackage.open(source),d=model(pkg);
  const layout=layoutDocument(d.paragraphs,(text,style)=>({width:[...text].length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(d.pageSettings),d.numbering,d.tables);
  expect(layout.pageCount).toBe(1);expect(layout.cells).toHaveLength(8);
  const inner=d.tables.find(t=>t.parentCellId),outerBox=layout.cells.find(c=>c.id===inner.parentCellId);
  const innerBoxes=layout.cells.filter(c=>c.tableId===inner.id);
  for(const box of innerBoxes){expect(box.x).toBeGreaterThan(outerBox.x);expect(box.x+box.width).toBeLessThan(outerBox.x+outerBox.width);expect(box.y).toBeGreaterThan(outerBox.y);expect(box.y+box.height).toBeLessThan(outerBox.y+outerBox.height);}
  const before=layout.lines.find(l=>l.start===d.text.indexOf('Outer before')),after=layout.lines.find(l=>l.start===d.text.indexOf('Outer after'));
  expect(Math.min(...innerBoxes.map(c=>c.y))).toBeGreaterThanOrEqual(before.y+before.height);
  expect(after.y).toBeGreaterThanOrEqual(Math.max(...innerBoxes.map(c=>c.y+c.height)));
  const line=layout.lines.find(l=>l.start===d.text.indexOf('Inner A1'));
  expect(hitTest(layout,0,line.stops[0].x,line.y+line.height/2)).toBe(line.start);
});
it.each(['first','center','autofit','deep','paging'])('lays out the independent %s nested-table fixture without losing cell geometry',async variant=>{
  const pkg=await DocxPackage.open(readFileSync(`tests/fixtures/nested-tables/nested-table-${variant}.docx`)),d=model(pkg);
  const layout=layoutDocument(d.paragraphs,(text,style)=>({width:[...text].length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(d.pageSettings),d.numbering,d.tables);
  expect(layout.pageCount).toBe(variant==='paging'?2:1);
  expect(new Set(layout.cells.map(c=>c.id)).size).toBe(variant==='paging'?64:variant==='deep'?9:8);
  for(const inner of d.tables.filter(t=>t.parentCellId))for(const box of layout.cells.filter(c=>c.tableId===inner.id)){
    const parent=layout.cells.find(c=>c.id===inner.parentCellId&&c.page===box.page);
    expect(parent).toBeTruthy();expect(box.x).toBeGreaterThanOrEqual(parent.x);expect(box.x+box.width).toBeLessThanOrEqual(parent.x+parent.width+1e-6);expect(box.y).toBeGreaterThanOrEqual(parent.y);expect(box.y+box.height).toBeLessThanOrEqual(parent.y+parent.height+1e-6);
  }
  for(const line of layout.lines){expect(Number.isFinite(line.y)).toBe(true);expect(hitTest(layout,line.page,line.stops[0].x,line.y+line.height/2)).toBe(line.start);}
});
