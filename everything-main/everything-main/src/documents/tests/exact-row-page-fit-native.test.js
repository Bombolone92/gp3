import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const root='tests/fixtures/exact-row-page-fit/';
const reference=JSON.parse(readFileSync(root+'reference.json'));
const cases=JSON.parse(readFileSync(root+'cases.json'));
const source=readFileSync(root+'exact-row-page-fit-20261004.docx');
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure=(text,style)=>({width:[...text].length*style.fontSize*2/3,ascent:style.fontSize,descent:style.fontSize/3});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
it('binds every authored boundary case to the native source and PDF',()=>{
 for(const [file,key] of [['exact-row-page-fit-20261004.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256']])
  expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(reference[key]);
 expect(reference.rows.map(r=>r.label)).toEqual(cases.labels.map(r=>r.label));
});
it('matches native row placement for one-twip and opposing border boundaries',async()=>{
 const doc=model(await DocxPackage.open(source)),placed=layout(doc);
 expect(placed.pageCount).toBe(reference.pages);
 for(const [i,row] of reference.rows.entries()) {
  const group=Math.floor(i/37),index=i%37,id=doc.tables[group].rows[index].cells[0].id;
  expect(placed.cells.find(c=>c.id===id)?.page,row.label+' '+cases.cases[group].name).toBe(row.page);
 }
});
it.each(['theme-minmax-neighbors','theme-standard-accents'])('matches every native row and page of the earlier %s holdout',async name=>{
 const path='tests/fixtures/'+name+'/',native=JSON.parse(readFileSync(path+'reference.json'));
 const doc=model(await DocxPackage.open(readFileSync(path+name+'-20261004.docx'))),placed=layout(doc);
 expect(placed.pageCount).toBe(native.pages);
 for(const [i,row] of native.colors.entries()) {
  const id=doc.tables[0].rows[i].cells[0].id;
  expect(placed.cells.find(c=>c.id===id)?.page,row.label).toBe(row.page);
 }
});
