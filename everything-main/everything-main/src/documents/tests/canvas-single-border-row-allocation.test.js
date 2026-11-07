import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {tableBorderWidth} from '../src/engine/table-border-layout.js';

let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/print-border-phase/';
const source=readFileSync(folder+'control.docx');
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const native=JSON.parse(readFileSync(folder+'native-metafile-rectangles.json'));

it('matches native flowing row boundaries without changing authored single-border pens',async()=>{
 expect(createHash('sha256').update(source).digest('hex')).toBe(native.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'cases.json')).digest('hex')).toBe(native.casesSha256);
 expect(native.sourceUnchanged).toBe(true);expect(native.pages).toHaveLength(1);
 expect(native.pages[0].windowExtent).toEqual([5100,6600]);
 const blue=native.pages[0].fills.filter(f=>f.colorRef===0x917f6d);
 expect(blue).toHaveLength(16*12);expect(blue.every(f=>!f.clips.length)).toBe(true);
 const pkg=await DocxPackage.open(source);
 expect(pkg.readOnly).not.toBe(true);
 const layout=layoutDocument(pkg.paragraphs,()=>({width:0,ascent:0,descent:0}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 expect(layout.pageCount).toBe(1);
 const groups=new Map();
 for(const s of layout.tableBorders)if(!s.guide&&s.horizontal){
  if(!groups.has(s.tableId))groups.set(s.tableId,[]);
  groups.get(s.tableId).push(s);
 }
 expect(groups.size).toBe(cases.length);
 for(const [index,strokes]of [...groups.values()].entries()){
  const fills=blue.slice(index*12,(index+1)*12).map(f=>f.destination);
  const bounds=[Math.min(...fills.map(r=>r[1])),Math.max(...fills.map(r=>r[1]+r[3]))];
  const actual=[Math.min(...strokes.map(s=>s.y)),Math.max(...strokes.map(s=>s.y+s.height))];
  expect(actual.map(v=>Math.round(v*.75/.12+1e-5)),`table ${index}`).toEqual(bounds);
  for(const stroke of strokes){
   expect(stroke.border.size).toBe(cases[index].sizeEighthPoints);
   expect(stroke.height).toBeCloseTo(tableBorderWidth(stroke.border),12);
  }
 }
});
