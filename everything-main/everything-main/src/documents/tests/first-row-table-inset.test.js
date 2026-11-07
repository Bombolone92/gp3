import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/first-row-table-inset.docx');
const measure=(text,style)=>({width:text.length*style.fontSize/2,ascent:style.fontSize,descent:style.fontSize/3});
it('aligns the complete table using only the first row, including fixed and centered/right tables',async()=>{
 const p=await DocxPackage.open(source),before=JSON.stringify(p.tables);
 const l=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
 const expected=[82,85,83.5,85,82,85,116,150];
 for(let table=0;table<8;table++)for(let row=0;row<2;row++)for(let column=0;column<2;column++){
  const text=`C${table}R${row}X${column}`,line=l.lines.find(l=>l.fragments.some(f=>f.text===text));
  expect(line.fragments[0].x*.75,text).toBeCloseTo(expected[table]+column*200,6);
 }
 expect(JSON.stringify(p.tables)).toBe(before);
});
it('keeps legacy top-level grid alignment independent of side border widths',async()=>{
 const p=await DocxPackage.open(source);
 const l=layoutDocument(p.paragraphs,measure,pageGeometry({...p.pageSettings,compatibilityMode:14}),p.numbering,p.tables);
 for(let table=0;table<6;table++){
  const line=l.lines.find(l=>l.fragments.some(f=>f.text===`C${table}R0X0`));
  expect(line.fragments[0].x*.75).toBeCloseTo(82,6);
 }
});
