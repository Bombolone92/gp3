import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {imageInfo,validateImageAssets} from '../src/engine/images.js';
const source=readFileSync('tests/fixtures/large-raster-parts/control.docx'),parts=unzipSync(source);
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
it.each(['jpg','png'])('accepts a large encoded %s with small decoded dimensions',ext=>{
 const bytes=parts['word/media/large.'+ext];expect(bytes.length).toBeGreaterThan(10*1024*1024);
 expect(imageInfo(bytes)).toEqual({mime:ext==='jpg'?'image/jpeg':'image/png',width:64,height:32});
 expect(()=>validateImageAssets({image:{bytes}})).not.toThrow();
});
it('retains session-byte and decoded-pixel limits',()=>{
 const bytes=parts['word/media/large.jpg'];
 expect(()=>validateImageAssets(Object.fromEntries(Array.from({length:5},(_,i)=>[i,{bytes}])))).toThrow(/50 MB/);
 expect(()=>imageInfo(new Uint8Array(50*1024*1024+1))).toThrow(/50 MB/);
 const oversized=new Uint8Array(parts['word/media/large.png']);new DataView(oversized.buffer).setUint32(16,8193);
 expect(()=>imageInfo(oversized)).toThrow(/8,192/);
});
it('preserves large source media through picture edits, export, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const exact=bytes=>{const out=unzipSync(bytes);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 exact(await save());d.replace('Edited ');
 const at=d.text.indexOf('\ufffc',d.text.indexOf('\ufffc')+1);d.select(at,at+1);d.setImageProperties({alt:'Large JPEG',width:2743200,height:342900});
 const bytes=await save(),out=unzipSync(bytes),again=await DocxPackage.open(bytes);
 expect(again.paragraphs.flatMap(p=>p.runs).find(r=>r.image?.alt==='Large JPEG').image.width).toBe(2743200);
 for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 d.undo();d.undo();exact(await save());
},30000);
