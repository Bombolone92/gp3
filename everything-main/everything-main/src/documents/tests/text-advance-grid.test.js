import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
const folder='tests/fixtures/text-advance-grid/';
it('binds the 24 independent native rows and preserves the authored package',async()=>{
 const ref=JSON.parse(readFileSync(folder+'reference.json')),cases=JSON.parse(readFileSync(folder+'cases.json'));
 const hash=n=>createHash('sha256').update(readFileSync(folder+n)).digest('hex');
 expect(hash('control.docx')).toBe(ref.sourceSha256);expect(hash('cases.json')).toBe(ref.casesSha256);
 expect(ref.pdfSha256).toMatch(/^[a-f0-9]{64}$/);expect(ref.records).toHaveLength(24);
 for(const [i,r]of ref.records.entries()){
  expect(r.id).toBe(cases[i].id);expect(r.glyphLeftsPt).toHaveLength(20);
  expect(r.averageAdvancePt).toBeCloseTo((r.glyphLeftsPt[19]-r.glyphLeftsPt[0])/19,10);
 }
 const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 try{
  const bytes=readFileSync(folder+'control.docx'),p=await DocxPackage.open(bytes);
  expect(p.readOnly).not.toBe(true);expect(p.paragraphs.map(p=>p.runs.map(r=>r.text).join(''))).toEqual(cases.map(c=>c.text));
  expect(unzipSync(new Uint8Array(await p.export().arrayBuffer()))).toEqual(unzipSync(bytes));
 }finally{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
},60000);
