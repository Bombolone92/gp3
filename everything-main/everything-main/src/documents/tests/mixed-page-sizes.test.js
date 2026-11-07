import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,verticalLine,hitTest,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const source=readFileSync('public/fixtures/mixed-page-sizes.docx'),ref=JSON.parse(readFileSync('tests/fixtures/mixed-page-sizes/reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const layout=d=>layoutDocument(d.paragraphs,t=>({width:t.length*6,ascent:12,descent:4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
it('uses each section size and cumulative page heights for navigation without rewriting the package',async()=>{
 const p=await DocxPackage.open(source),d=model(p),l=layout(d);expect(l.pages.map(p=>[p.width*.75,p.height*.75])).toEqual(ref.sizes);
 expect(l.pageOffsets).toEqual([0,1056,1872,2832]);
 for(let page=0;page<3;page++){
  const last=l.lines.filter(x=>x.page===page).at(-1),next=l.lines.find(x=>x.page===page+1);
  expect(verticalLine(l,last,1,last.stops[0].x)).toBe(next);expect(verticalLine(l,next,-1,next.stops[0].x)).toBe(last);
  const caret=caretRect(l,next.start);expect(hitTest(l,caret.page,caret.x,caret.y+caret.height/2)).toBe(next.start);
 }
 const last=l.lines.filter(x=>x.page===0).at(-1),lower={...last,y:950,baseline:962};
 const nearBottom={...l,lines:l.lines.map(x=>x===last?lower:x)},next=l.lines.find(x=>x.page===1);
 expect(verticalLine(nearBottom,lower,1,lower.stops[0].x)).toBe(next);
 expect(verticalLine(nearBottom,next,-1,next.stops[0].x)).toBe(lower);
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('inserts tables using the selected section width and restores section markup with undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 for(let i=0;i<4;i++){
  const at=d.text.indexOf(`Section ${i+1} opening`);d.select(at);const initial=d.snapshot();
  d.insertTable(1,2);expect(d.tables.at(-1).grid.reduce((a,b)=>a+b,0)).toBe(ref.sizes[i][0]*20-1440);
  const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.paragraphs.filter(p=>p.sectionEnd).map(p=>[p.sectionEnd.width,p.sectionEnd.height])).toEqual(ref.sizes.slice(0,3).map(s=>s.map(v=>v*20)));
  d.undo();expect(d.snapshot()).toEqual(initial);expect(unzipSync(await save(p,d))).toEqual(p.parts);
 }
},30000);
it('merges and splits a percentage table against its own landscape section',async()=>{
 const p=await DocxPackage.open(source),d=model(p);const at=d.text.indexOf('S2R1C1'),end=d.text.indexOf('S2R1C2')+6;d.select(at,end);
 d.mergeCells();expect(d.tables[1].rows[0].cells[0].width.value).toBe(14400);d.splitCell();
 expect(d.tables[1].rows[0].cells.map(c=>c.width.value)).toEqual([7200,7200]);
 d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('retains the document-wide page background across every section size',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:body>','<w:background w:color="DDEEFF"/><w:body>'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);expect(layout(d).pages.map(p=>p.background)).toEqual(Array(4).fill('#DDEEFF'));
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
