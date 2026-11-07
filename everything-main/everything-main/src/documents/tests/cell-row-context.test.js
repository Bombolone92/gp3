import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const folder='tests/fixtures/cell-row-context',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const geometry=d=>layout(d).lines.map(l=>[l.fragments.map(f=>f.text||'').join(''),l.page,l.stops[0]?.x,l.baseline]);
it('retains independent native source and PDF hashes',()=>{for(const ref of Object.values(refs))for(const[n,h]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);});
it('retains before-spacing at each new row while suppressing it between same-style cells',async()=>{
  const p=await DocxPackage.open(readFileSync(`${folder}/control.docx`)),l=layout(p);
  const offset=(table,row,col)=>{const c=p.tables[table].rows[row].cells[col],line=l.lines.find(x=>x.cellId===c.id),box=l.cells.find(x=>x.id===c.id);return line.baseline-box.y;};
  for(const table of [0,1,2,3,4,5,6,7,8,9,10,11])for(const row of [1,2])expect(offset(table,row,0)).toBeCloseTo(offset(table,0,0),6);
  for(const table of [3,4,5])for(const row of [0,1,2])expect(offset(table,row,0)-offset(table,row,1)).toBeCloseTo(8,6);
  for(const table of [9,10,11])for(const row of [0,1,2])expect(offset(table,row,0)-offset(table,row,1)).toBeCloseTo(4,6);
});
for(const name of ['control','merge'])it(`${name}: preserves contextual layout through merge/split, export and exact undo`,async()=>{
  const source=readFileSync(`${folder}/${name}.docx`),p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const before=geometry(d),save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  if(name==='control'){
    d.selectCell(d.tables[9].rows[0].cells[0].id);d.mergeCellBelow();
    expect(d.tables[9].rows[1].cells[0].continuationStyleId).toBe(d.styles.defaultParagraph);
  }else{
    expect(d.tables.map(t=>t.rows[1].cells[0].continuationStyleId)).toEqual(['Shared',null]);
    d.selectCell(d.tables[0].rows[0].cells[0].id);d.splitCell();
    for(const row of d.tables[0].rows)expect(row.cells[0].continuationStyleId).toBeUndefined();
  }
  const edited=await save(),reopened=await DocxPackage.open(edited),out=unzipSync(edited),parts=unzipSync(source);
  expect(geometry(reopened)).toEqual(geometry(d));
  for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
  d.undo();expect(geometry(d)).toEqual(before);const undo=unzipSync(await save());for(const n of Object.keys(parts))expect(Buffer.from(undo[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
