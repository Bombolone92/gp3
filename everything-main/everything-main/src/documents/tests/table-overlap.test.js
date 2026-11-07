import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {avoidTableOverlap,shiftTableItem} from '../src/engine/table-overlap.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/table-overlap/';
const source=readFileSync(folder+'probe.docx');
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it.each(['probe','width','gap','words'])('pins the independently authored reference control %s',name=>{
 const ref=JSON.parse(readFileSync(folder+name+'-reference.json'));
 for(const [file,key] of [[name+'.docx','sourceSha256'],[name+'-native.pdf','pdfSha256']])expect(createHash('sha256').update(readFileSync(folder+file)).digest('hex')).toBe(ref[key]);
});
it('preserves overlap properties through edit, export, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 expect(p.tables.filter(t=>t.overlap==='never')).toHaveLength(12);
 expect(unzipSync(await save(p,d))).toEqual(p.parts);d.selectCell(d.tables[4].rows[0].cells[0].id);d.replace('Edited ');
 const out=await save(p,d),again=await DocxPackage.open(out);expect(again.tables.map(t=>t.overlap)).toEqual(p.tables.map(t=>t.overlap));
 expectBodyEditParts(unzipSync(out),p.parts);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
},30000);
it.each(['<w:tblOverlap/>','<w:tblOverlap w:val="true"/>','<w:tblOverlap w:val="never" other="x"/>','<w:tblOverlap w:val="never">text</w:tblOverlap>','<w:tblOverlap w:val="never"/><w:tblOverlap w:val="never"/>'])('rejects malformed overlap %s',async xml=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:tblOverlap w:val="never"/>',xml));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
const page={width:816,height:1056,left:96,right:96};
const position={leftFromText:0,rightFromText:0,topFromText:0,bottomFromText:0};
const frame={page:0,left:96,right:256,top:120,bottom:264,position};
it('resolves chains and respects page isolation without mutating authored positions',()=>{
 const first={...frame,overlap:'never'},second=avoidTableOverlap(frame,[first],page),third=avoidTableOverlap({...frame,overlap:'never'},[first,second],page);
 expect(second.left).toBeGreaterThan(first.right);expect(third.left).toBeGreaterThan(second.right);
 expect(avoidTableOverlap({...frame,page:1},[first],page).left).toBe(frame.left);
 expect(frame.left).toBe(96);expect(position).toEqual({leftFromText:0,rightFromText:0,topFromText:0,bottomFromText:0});
});
it('moves wrapped selection segments, shared caret stops, paint and clips together',()=>{
 const stop={offset:4,x:20},segment={stops:[stop],fragments:[{x:20,text:'A'}]},line={x:20,y:30,baseline:40,stops:[stop],fragments:segment.fragments,wrapSegments:[segment],cellClip:{left:10,right:50,top:20,bottom:60},paragraphFrame:{x:10,right:50},underlines:[{x:20,width:10}]};
 const moved=shiftTableItem(line,100,200);
 expect(moved.stops[0]).toBe(moved.wrapSegments[0].stops[0]);expect(moved.wrapSegments[0].stops[0].x).toBe(120);
 expect(moved.cellClip).toEqual({left:110,right:150,top:220,bottom:260});expect(moved.baseline).toBe(240);expect(moved.paragraphFrame).toEqual({x:110,right:150});expect(moved.underlines[0].x).toBe(120);expect(stop.x).toBe(20);
});
it('revisits a tall obstacle after wrapping below a shorter neighbour',()=>{
 const tall={...frame,top:0,bottom:500,overlap:'never'},short={...frame,left:260,right:420,top:0,bottom:100,overlap:'never'};
 const result=avoidTableOverlap({...frame,right:396,top:0,bottom:144},[tall,short],page);
 expect(result.top).toBe(100);expect(result.left).toBeGreaterThan(tall.right);expect(result.right).toBeLessThan(page.width-page.right);
});
