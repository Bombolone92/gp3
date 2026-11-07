import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
const folder='tests/fixtures/outline-stroke-holdouts/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds native source packages and all 48 JPEG-derived measurement regions',()=>{
 expect(ref.observations).toHaveLength(6);
 for(const [name,source] of Object.entries(ref.sources)){
  const bytes=readFileSync(folder+name+'.docx');expect(hash(bytes)).toBe(source.sha256);
  const parts=unzipSync(bytes);expect(Object.keys(parts).sort()).toEqual(Object.keys(source.parts).sort());
  for(const [part,data] of Object.entries(parts))expect(hash(data),part).toBe(source.parts[part]);
 }
 for(const o of ref.observations){expect(o.sourceFormat).toBe('JPEG');expect(o.regions).toHaveLength(8);expect(hash(readFileSync(folder+o.crop))).toBe(o.cropSha256);}
});
it.each(['rotation-alpha','alpha-only'])('retains all stroke declarations on editable import and exact export: %s',async name=>{
 const bytes=readFileSync(folder+name+'.docx'),pkg=await DocxPackage.open(bytes);
 expect(pkg.readOnly).not.toBe(true);expect(pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image)).toHaveLength(8);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
},30000);

it('imports the open compound curve with all seven siblings and original parts',async()=>{
 const bytes=readFileSync(folder+'dash-compound.docx');
 const pkg=await DocxPackage.open(bytes);expect(pkg.readOnly).not.toBe(true);
 expect(pkg.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image.id)).toEqual([1,2,3,4,5,6,7,8]);
 expect(pkg.parts).toEqual(unzipSync(bytes));
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
},30000);
