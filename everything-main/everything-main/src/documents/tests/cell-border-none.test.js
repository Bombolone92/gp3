import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {refreshConditionalTable} from '../src/engine/conditional-table-formatting.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const root='tests/fixtures/cell-border-none/';
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const bytes=(p,d)=>p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer().then(b=>new Uint8Array(b));
function sameParts(a,b){expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);}

it('distinguishes direct default none from colored or nonzero none while retaining source attributes',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'matrix.docx'));
  for(const [i,table] of pkg.tables.entries())for(const cell of table.rows[0].cells){
    expect(cell.directBorders.top).toMatchObject({style:'none',size:[0,0,8,8,16,16][i],color:i%2?'A030A0':'auto'});
    if(i===0)expect(cell.borders.top).toBeUndefined();
    else expect(cell.borders.top).toEqual(cell.directBorders.top);
  }
});

it('gives first-row borders precedence over overlapping last-row borders after recomputation',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'style.docx'));
  for(const table of pkg.tables){
    for(let i=0;i<2;i++){
      refreshConditionalTable(table);
      for(const cell of table.rows[0].cells)expect(cell.borders.top).toMatchObject({style:'single',size:8,color:'2050D0'});
    }
  }
});

for(const kind of ['matrix','edges','style','spacing','spacing-rules','style-only','priority','properties'])it(`${kind}: binds native evidence and preserves no-edit, text edits and exact undo`,async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+kind+'.docx')),doc=model(pkg);
  const native=JSON.parse(readFileSync(root+kind+'-native.json','utf8'));
  for(const [name,hash] of Object.entries(native.partSha256))expect(createHash('sha256').update(pkg.parts[name]).digest('hex')).toBe(hash);
  sameParts(unzipSync(await bytes(pkg,doc)),pkg.parts);
  doc.select(0);doc.replace('Edited ');
  const saved=await bytes(pkg,doc),reopened=await DocxPackage.open(saved);
  expect(reopened.tables.map(t=>t.rows.map(r=>r.cells.map(c=>[c.directBorders,c.borders])))).toEqual(doc.tables.map(t=>t.rows.map(r=>r.cells.map(c=>[c.directBorders,c.borders]))));
  const edited=unzipSync(saved);
  expectBodyEditParts(edited,pkg.parts);
  doc.undo();sameParts(unzipSync(await bytes(pkg,doc)),pkg.parts);
});

it('omits last-row run and cell properties when the same row is a first row',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'properties.docx'));
  const native=JSON.parse(readFileSync(root+'properties-native.json','utf8'));
  for(const [i,table]of pkg.tables.entries())for(const [j,cell]of table.rows[0].cells.entries()){
    const run=pkg.paragraphs.find(p=>p.cellId===cell.id).runs[0];
    const expected=native.pages[i].origins.find(o=>o.text===`Cell${j+1}`);
    expect(run.bold,`page ${i+1} cell ${j+1}`).toBe(/Bold/.test(expected.font));
    expect(run.italic,`page ${i+1} cell ${j+1}`).toBe(/Italic|Oblique/.test(expected.font));
    expect(cell.fill).toBe([0,1,4].includes(i)?'#D0E0F0':'#F0D0E0');
  }
});

it('restores direct none provenance after a cell-border edit and undo',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'matrix.docx')),doc=model(pkg);
  doc.select(doc.text.indexOf('Cell 1'));
  doc.setCellBorders({top:{style:'single',size:24,color:'123456'}});
  const reopened=await DocxPackage.open(await bytes(pkg,doc));
  expect(reopened.tables[0].rows[0].cells[0].directBorders.top).toMatchObject({style:'single',size:24,color:'123456'});
  doc.undo();sameParts(unzipSync(await bytes(pkg,doc)),pkg.parts);
});
