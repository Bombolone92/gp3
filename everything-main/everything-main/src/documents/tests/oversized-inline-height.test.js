import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect,selectionRects,imageAtPoint} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {squareRow,joinSquareLine} from '../src/engine/square-wrap.js';
import {assertPackageParts} from './helpers/assert-package-parts.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const root='tests/fixtures/oversized-body-lines/';
const refs=JSON.parse(readFileSync(root+'reference.json')).records;
const measure=(text,style)=>({width:text.length*style.fontSize*.65,ascent:style.fontSize,descent:style.fontSize/3});
const layout=p=>layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
for(const name of ['inline-fresh','inline-preceded','inline-beyond-page','inline-consecutive'])it(`retains authored tall drawing geometry and visible editing bounds: ${name}`,async()=>{
 const bytes=readFileSync(root+name+'.docx'),ref=refs[name];expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 const p=await DocxPackage.open(bytes),result=layout(p);expect(result.pageCount).toBe(ref.pages.length);
 const lines=result.lines.filter(l=>l.fragments.some(f=>f.image));expect(lines.length).toBe(ref.pages.flatMap(p=>p.pictures).length);
 for(const line of lines){
  const f=line.fragments.find(f=>f.image),native=ref.pages[line.page].pictures[0];expect(native).toBeTruthy();expect(line.oversizedInlineHeight).toBe(true);
  for(const [actual,expected] of [[f.x*.75,native.x],[(line.baseline-f.ascent)*.75,native.y],[f.width*.75,native.width],[f.ascent*.75,native.height]])expect(actual).toBeCloseTo(expected,4);
  const caret=caretRect(result,f.start);expect(caret.y).toBeGreaterThanOrEqual(0);expect(caret.y+caret.height).toBeLessThanOrEqual(result.pages[line.page].height);
  const rects=selectionRects(result,f.start,f.end);expect(rects.length).toBeGreaterThan(0);for(const r of rects){expect(r.y).toBeGreaterThanOrEqual(0);expect(r.y+r.height).toBeLessThanOrEqual(result.pages[r.page].height);}
  expect(imageAtPoint(result,line.page,f.x+1,60)).toBe(f);expect(imageAtPoint(result,line.page,f.x+1,result.pages[line.page].height+1)).toBeNull();
 }
});
it('edits, exports and reopens around tall drawings with exact undo and untouched parts',async()=>{
 const bytes=readFileSync(root+'inline-preceded.docx'),p=await DocxPackage.open(bytes),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');expect(layout(d).pageCount).toBe(3);const exported=await save(),out=unzipSync(exported);
 for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(Buffer.from(out[name]).equals(Buffer.from(data)),name).toBe(true);
 expect(layout(await DocxPackage.open(exported)).pageCount).toBe(3);d.undo();assertPackageParts(unzipSync(await save()),unzipSync(bytes));
});
it('square wrapping advances an occupied oversized drawing once and terminates on a fresh page',()=>{
 const page={height:200,top:20,bottom:20},edges={left:20,right:280};
 for(const y of [20,50]){
  const hints={paragraphs:new Map([['p',[{y,page:0,height:240,fitHeight:240,start:0,oversizedInlineHeight:true}]]]),exclusions:[{page:0,left:20,right:100,top:0,bottom:200,side:'both'}]};
  expect(squareRow(hints,'p',0,edges,page)).toEqual({intervals:[y===20?{left:100,right:280}:edges],before:0});
 }
});

it('keeps the overflow policy when square-wrap pieces are joined',()=>{
 const piece=(start,ascent)=>({start,end:start+1,ascent,descent:4,height:ascent+4,fitHeight:ascent+4,baseline:ascent,fragments:[],stops:[],leaders:[],backgrounds:[],underlines:[],strikes:[]});
 const joined=joinSquareLine([piece(0,12),{...piece(1,300),oversizedInlineHeight:true}],0,{lineRule:'auto',lineSpacing:1});
 expect(joined.oversizedInlineHeight).toBe(true);expect(joined.fitHeight).toBe(304);
});
it('does not treat a baseline shift of a small drawing as an oversized authored extent',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'inline-fresh.docx'));
 const image=p.paragraphs[0].runs.find(r=>r.image);image.image={...image.image,height:72*12700};image.baselineShift=200;
 p.pageSettings={...p.pageSettings,height:3000,top:200,bottom:200};
 expect(()=>layout(p)).toThrow(/page height/);
});
