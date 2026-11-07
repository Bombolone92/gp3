import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { imageInfo, validateImageAssets } from '../src/engine/images.js';
import { isTiff } from '../src/engine/tiff-images.js';
import { tiffWorker } from '../src/lib/hwp/tiff-worker.js';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { tiff } from './helpers/image-fixtures.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/tiff-pictures';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it.each([true,false])('reads %s-endian TIFF bytes, including subarray offsets',little=>{
  const bytes=tiff({little}),backing=new Uint8Array(bytes.length+17);backing.set(bytes,9);
  expect(imageInfo(backing.subarray(9,9+bytes.length))).toEqual({mime:'image/tiff',width:2,height:1});
  expect(isTiff(bytes.subarray(0,4))).toBe(false);
});
it('keeps encoded dimensions for all reference orientation cases and validates aggregate limits',()=>{
  for(let i=1;i<=17;i++)expect(imageInfo(readFileSync(`${folder}/image${i}.tiff`))).toEqual({mime:'image/tiff',width:90,height:60});
  expect(()=>validateImageAssets({a:{mime:'image/tiff',bytes:readFileSync(`${folder}/image1.tiff`)}})).not.toThrow();
});
const patchTag=(tag,value)=>{
  const bytes=Uint8Array.from(readFileSync(`${folder}/image1.tiff`)),v=new DataView(bytes.buffer),at=v.getUint32(4,true),n=v.getUint16(at,true);
  for(let i=0;i<n;i++){const pos=at+2+12*i;if(v.getUint16(pos,true)===tag){if(v.getUint16(pos+2,true)===3)v.setUint16(pos+8,value,true);else v.setUint32(pos+8,value,true);return bytes;}}
  throw new Error('Missing test tag');
};
it.each([[274,9],[256,9000],[257,9000],[259,999],[273,0xffffffff]])('rejects invalid or unsupported TIFF tag %s before worker allocation',(tag,value)=>{
  expect(()=>imageInfo(patchTag(tag,value))).toThrow();
});
it('rejects truncated TIFF directories and oversized assets',()=>{
  expect(()=>imageInfo(readFileSync(`${folder}/image1.tiff`).subarray(0,100))).toThrow();
  const oversized=new Uint8Array(10*1024*1024+1);oversized.set(tiff());
  expect(()=>imageInfo(oversized)).toThrow(/10 MB/);
});
it('bounds the TIFF worker lifetime and transfers only the supplied view',async()=>{
  vi.useFakeTimers();const instances=[];
  class Worker {
    constructor(){instances.push(this);}
    terminate=vi.fn();postMessage=vi.fn();
  }
  vi.stubGlobal('Worker',Worker);
  const bytes=readFileSync(`${folder}/image1.tiff`),pending=tiffWorker(bytes),worker=instances[0];
  const rejection=expect(pending).rejects.toThrow(/timed out/);
  expect(worker.postMessage.mock.calls[0][0]).toEqual(new Uint8Array(bytes));
  expect(worker.postMessage.mock.calls[0][0].buffer.byteLength).toBe(bytes.length);
  await vi.advanceTimersByTimeAsync(15000);await rejection;expect(worker.terminate).toHaveBeenCalledOnce();
});
it('retains every TIFF part across picture resizing, text edits, export, reopen and undo',async()=>{
  const bytes=readFileSync(`${folder}/control.docx`),p=await DocxPackage.open(bytes);
  const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),original=d.text;
  const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(unzipSync(bytes));
  const at=d.text.indexOf('\ufffc');d.select(at,at+1);d.setImageProperties({width:914400,height:457200,alt:'Resized TIFF'});
  d.select(0);d.replace('Edited ');const edited=await save(),parts=unzipSync(bytes),changed=unzipSync(edited);
  expectBodyEditParts(changed,parts);
  const reopened=await DocxPackage.open(edited);expect(reopened.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image).toMatchObject({width:914400,alt:'Resized TIFF'});
  d.undo();d.undo();expect(d.text).toBe(original);expect(unzipSync(await save())).toEqual(parts);
}, 60000);
