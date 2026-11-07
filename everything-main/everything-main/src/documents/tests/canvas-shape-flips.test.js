import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/shape-flips.docx');
const shapes=p=>Object.values(p.assets).map(a=>{let s=a.scene;while(s.type==='group')s=s.children[0];return {...s,text:s.text?{...s.text,paragraphs:s.text.paragraphs.map(({id,...p})=>p)}:null};});
it('keeps both shape flip axes across editing, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),before=shapes(p);
 expect(before.map(s=>[!!s.flipH,!!s.flipV])).toEqual([[false,false],[true,false],[false,true],[true,true],[true,false],[true,true]]);
 expect(before.map(s=>s.paths[0].points)).toEqual(Array(6).fill(before[0].paths[0].points));
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');expect(shapes(await DocxPackage.open(await save()))).toEqual(before);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each(['flipH="yes"','flipV="2"','rot="2147483648"','rot="1.5"'])('keeps unsupported or malformed shape transforms guarded: %s',async attr=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('flipH="true"',attr));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});

it('preserves a valid quarter-turn in the flipped-shape fixture across editing and undo',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('flipH="true"','rot="5400000"'));
 const p=await DocxPackage.open(zipSync(parts)),before=shapes(p);
 expect(before.map(s=>s.shapeRotation||0)).toEqual([0,0,0,5400000,0,0]);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(parts);d.select(0);d.replace('Edited ');
 expect(shapes(await DocxPackage.open(await save()))).toEqual(before);
 d.undo();expect(unzipSync(await save())).toEqual(parts);
});
