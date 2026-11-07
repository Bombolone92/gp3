import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {clearingBreakTarget,squareRow} from '../src/engine/square-wrap.js';
let dom;
beforeAll(()=>{dom=new JSDOM();for(const name of ['Node','document','DOMParser','XMLSerializer'])globalThis[name]=dom.window[name];});
afterAll(()=>{dom.window.close();for(const name of ['Node','document','DOMParser','XMLSerializer'])delete globalThis[name];});
const source=()=>readFileSync('tests/fixtures/clearing-break-wrapping/body.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const breaks=d=>d.paragraphs.flatMap(p=>p.runs).filter(r=>r.breakClear);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());

it('retains semantic clearing breaks through adjacent typing, formatting, deletion, export and exact undo',async()=>{
 const p=await DocxPackage.open(source()),d=model(p);
 expect(breaks(d).map(r=>r.breakClear)).toEqual(Array(4).fill(['none','left','right','all']).flat());
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
 const offset=d.text.indexOf('\v');d.select(offset+1);d.replace('X');
 expect(breaks(d)).toHaveLength(16);expect(d.paragraphs.flatMap(p=>p.runs).find(r=>r.text.includes('X')).breakClear).toBeUndefined();
 d.select(offset,offset+1);d.setRunFormat({bold:true});
 const output=await save(p,d),again=model(await DocxPackage.open(output));
 expect(breaks(again)).toHaveLength(16);expect(breaks(again)[0]).toMatchObject({text:'\v',breakClear:'none',bold:true});
 for(const [name,value]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(output)[name]).toEqual(value);
 d.select(offset,offset+1);d.replace('');expect(breaks(d)).toHaveLength(15);
 for(let i=0;i<3;i++)d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('keeps adjacent equally formatted clearing breaks as separate semantic characters',async()=>{
 const parts=unzipSync(source());parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:br w:clear="none"/>','<w:br w:clear="all"/><w:br w:clear="all"/>'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);expect(breaks(d)).toHaveLength(17);
 expect(breaks(d).every(r=>r.text==='\v')).toBe(true);d.select(0);d.replace('EDIT ');
 expect(breaks(model(await DocxPackage.open(await save(p,d))))).toHaveLength(17);
});

const hints=()=>({paragraphs:new Map([['p',[{start:0,end:10,page:0,y:100,height:20},{start:11,end:20,page:0,y:120,height:20}]]]),
 exclusions:[{page:0,left:0,right:60,top:100,bottom:160},{page:0,left:400,right:500,top:100,bottom:220}]});
const edges={left:0,right:500},interval={left:60,right:400},page={top:0,bottom:0,height:800};
it('clears only the requested side of the active LTR text region',()=>{
 const h=hints(),target=clear=>clearingBreakTarget(h,'p',10,clear,interval,true,edges);
 expect(target('left').bottom).toBe(160);expect(target('right').bottom).toBe(220);expect(target('all').bottom).toBe(220);
 const left=squareRow(h,'p',1,edges,page,0,0,target('left'));
 expect(left.before).toBe(40);expect(left.intervals).toEqual([{left:0,right:400}]);
 expect(squareRow(h,'p',1,edges,page,0,0,target('all'))).toMatchObject({before:100,intervals:[edges],clearancePage:0,clearanceBefore:100});
 expect(clearingBreakTarget(h,'p',10,'left',interval,false,edges)).toBeNull();
 expect(clearingBreakTarget(h,'p',10,'none',interval,true,edges)).toBeNull();
});
it('does not clear a full-width line or a float outside the paragraph extents',()=>{
 const h=hints();expect(clearingBreakTarget(h,'p',10,'all',edges,true,edges)).toBeNull();
 h.exclusions=[{page:0,left:600,right:700,top:100,bottom:300}];
 expect(clearingBreakTarget(h,'p',10,'all',interval,true,edges)).toBeNull();
});
