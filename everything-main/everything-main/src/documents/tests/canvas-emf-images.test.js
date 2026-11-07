import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {emfInfo,EMF_MIME} from '../src/engine/emf-images.js';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const source=readFileSync('public/fixtures/emf-paths.docx'),parts=unzipSync(source),base=parts['word/media/control0.emf'];
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const change=fn=>{const b=base.slice();fn(new DataView(b.buffer),b);return b;};
function recordOffset(bytes,type){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let at=0;at<bytes.length;at+=v.getUint32(at+4,true))if(v.getUint32(at,true)===type)return at;throw Error('Missing test record');}
it('imports all original EMF controls without modifying their media on edit/export/reopen/undo',async()=>{
 const pkg=await DocxPackage.open(source);expect(Object.values(pkg.assets).map(a=>a.mime)).toEqual(Array(8).fill(EMF_MIME));
 const d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const edited=await save(),out=unzipSync(edited),again=await DocxPackage.open(edited);
 expect(again.paragraphs[0].runs[0].text).toMatch(/^Edited /);
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(parts[name]);
 d.undo();expect(unzipSync(await save())).toEqual(parts);
});
it('implements the floating-point miter interpretation for both independently authored encodings',()=>{
 const float=unzipSync(readFileSync('public/fixtures/emf-paths-float-miter.docx'));
 expect(emfInfo(parts['word/media/control6.emf']).svg).toContain('stroke-miterlimit="1"');
 expect(emfInfo(float['word/media/control6.emf']).svg).toContain('stroke-miterlimit="10"');
});
it.each([
 ['record count',v=>v.setUint32(52,1,true)],
 ['header version',v=>v.setUint32(44,0,true)],
 ['record length',v=>v.setUint32(92,0,true)],
 ['point overrun',v=>v.setUint32(recordOffset(base,88)+24,100000,true)],
 ['zero mapping extent',v=>v.setInt32(recordOffset(base,9)+8,0,true)],
 ['unknown drawing record',v=>v.setUint32(recordOffset(base,88),99,true)],
 ['unknown handle',v=>v.setUint32(recordOffset(base,37)+8,100,true)],
 ['wide cosmetic pen',v=>v.setUint32(recordOffset(base,95)+28,0,true)],
 ['invalid pen',v=>v.setUint32(recordOffset(base,95)+28,7,true)],
 ['nonfinite miter',v=>v.setFloat32(recordOffset(base,58)+8,NaN,true)],
 ['excessive frame',v=>v.setInt32(32,100000000,true)],
])('rejects %s before creating a preview',(_,mutate)=>expect(()=>emfInfo(change(mutate))).toThrow(/Unsupported EMF/));
it('rejects truncated input and missing EOF',()=>{
 expect(()=>emfInfo(base.slice(0,70))).toThrow(/Unsupported EMF/);
 expect(()=>emfInfo(base.slice(0,-1))).toThrow(/Unsupported EMF/);
});
it('preserves the package in a read-only preview when a metafile contains unsupported drawing records',async()=>{
 const broken={...parts,'word/media/control0.emf':change(v=>v.setUint32(recordOffset(base,88),99,true))};
 await expect(DocxPackage.open(zipSync(broken))).rejects.toThrow(/record 99/);
 const pkg=await DocxPackage.open(zipSync(broken),{bestEffort:true});expect(pkg.readOnly).toBe(true);expect(Object.keys(pkg.assets)).toHaveLength(7);expect(pkg.parts).toEqual(broken);
});
it.each(['image/emf','image/x-emf'])('accepts the EMF content type %s and retains it',async mime=>{
 const changed={...parts,'[Content_Types].xml':strToU8(strFromU8(parts['[Content_Types].xml']).replace('image/x-emf',mime))};
 const pkg=await DocxPackage.open(zipSync(changed));expect(Object.keys(pkg.assets)).toHaveLength(8);expect(pkg.parts['[Content_Types].xml']).toEqual(changed['[Content_Types].xml']);
});
it('rejects a mismatched content type',async()=>{
 const changed={...parts,'[Content_Types].xml':strToU8(strFromU8(parts['[Content_Types].xml']).replace('image/x-emf','image/png'))};
 await expect(DocxPackage.open(zipSync(changed))).rejects.toThrow(/content types/);
});

it('uses the physical frame independently of tight drawing bounds, as in the native reference control',()=>{
 const inset=unzipSync(readFileSync('public/fixtures/emf-paths-inset-bounds.docx'));
 expect(emfInfo(inset['word/media/control0.emf'])).toEqual(emfInfo(base));
});

it('closes an open StrokeAndFillPath figure before stroking as well as filling',()=>{
 const original=parts['word/media/control7.emf'],at=recordOffset(original,61);
 const open=new Uint8Array(original.length-8);open.set(original.slice(0,at));open.set(original.slice(at+8),at);
 const v=new DataView(open.buffer);v.setUint32(48,open.length,true);v.setUint32(52,v.getUint32(52,true)-1,true);
 expect(emfInfo(open).svg).toBe(emfInfo(original).svg);
});

it('accepts detailed original controls with more than 10000 records without changing their drawing',async()=>{
 const source=readFileSync('tests/fixtures/emf-record-count/control.docx'),large=unzipSync(source);
 const reference=unzipSync(readFileSync('public/fixtures/emf-paths-float-miter.docx'));
 for(const name of Object.keys(large).filter(n=>n.endsWith('.emf'))){
  const b=large[name];expect(new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(52,true)).toBeGreaterThan(12000);
  expect(emfInfo(b)).toEqual(emfInfo(reference[name]));
 }
 const pkg=await DocxPackage.open(source);expect(Object.keys(pkg.assets)).toHaveLength(8);
});

it('retains the existing viewport for a degenerate physical frame even when pixel effects are requested',()=>{
 const bytes=change(v=>v.setInt32(32,v.getInt32(24,true),true));
 const {rasterFrame,...info}=emfInfo(bytes,{pixelEffects:true});
 expect(rasterFrame).toBeNull();expect(info).toEqual(emfInfo(bytes));
});
it('rejects impossible declared counts before traversal',()=>{
 expect(()=>emfInfo(change(v=>v.setUint32(52,0xffffffff,true)))).toThrow(/invalid record table/);
 expect(()=>emfInfo(change(v=>v.setUint32(52,0,true)))).toThrow(/invalid record table/);
});
