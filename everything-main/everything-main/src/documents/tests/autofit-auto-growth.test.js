import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {autoColumnWidths} from '../src/engine/tables.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const folder='tests/fixtures/autofit-auto-growth',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
it('retains source and native reference hashes',()=>{for(const ref of Object.values(refs))for(const[n,h]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);});
it('grows automatic totals for merged content while retaining an explicit table preference',()=>{
 const table={layout:'autofit',grid:[1200,1200,600,2400],width:{type:'dxa',value:5400},rows:[{cells:[{span:2,width:{type:'dxa',value:2400}},{width:{type:'dxa',value:600}},{width:{type:'dxa',value:2400}}]}]};
 const intrinsic=[{min:0,max:0,floor:0},{min:0,max:0,floor:0},{min:200,max:200,floor:100},{min:800,max:2400,floor:100}];
 const spans=[{column:0,span:2,min:3400,max:3400,floor:100}];
 const widths=autoColumnWidths(table,5400,intrinsic,5400,spans);
 expect(widths.reduce((a,b)=>a+b,0)).toBeCloseTo(5400,6);
 table.width={type:'auto',value:0};
 for(const limit of [6000,8000]){
  const grown=autoColumnWidths(table,8000,intrinsic,limit,spans);
  expect(grown.reduce((a,b)=>a+b,0)).toBeCloseTo(Math.min(limit,6400),6);
  expect(grown[0]+grown[1]).toBeGreaterThanOrEqual(3400-1e-6);
 }
});
for(const name of ['legacy-limit','legacy-wide','modern-wide'])it(`${name}: reflows edits and preserves package parts and exact undo`,async()=>{
 const source=readFileSync(`${folder}/${name}.docx`),p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),before=layout(d);
 const at=d.text.indexOf('MMMMMMMMMMMMMMMMMMMM');d.select(at,at+20);d.replace('W'.repeat(40));
 expect(layout(d).tableWidths).not.toEqual(before.tableWidths);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const edited=await save(),reopened=await DocxPackage.open(edited),parts=unzipSync(source),out=unzipSync(edited);
 expect(Object.values(layout(reopened).tableWidths)).toEqual(Object.values(layout(d).tableWidths));
 for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
 d.undo();expect(layout(d)).toEqual(before);const undo=unzipSync(await save());for(const n of Object.keys(parts))expect(Buffer.from(undo[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
