import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutDocument, imageAtPoint } from '../src/engine/layout.js';
const folder='tests/fixtures/anchor-offset-precision/';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const measure=(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize/3});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
for(const name of ['control','containers']) it(`matches all native signed offsets and preserves edits: ${name}`,async()=>{
 const bytes=readFileSync(folder+name+'.docx'),ref=reference[name];
 expect(hash(bytes)).toBe(ref.sourceSha256);expect(hash(readFileSync(folder+name+'-native.pdf'))).toBe(ref.pdfSha256);
 const pkg=await DocxPackage.open(bytes),doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const placed=layout(doc);expect(placed.pageCount).toBe(4);expect(placed.floatingObjects).toHaveLength(64);
 for(const [i,f] of placed.floatingObjects.entries()){
  const r=ref.rectangles[i];expect(f.page).toBe(r.page);
  expect(f.x*.75,`${name} ${i} x`).toBeCloseTo(r.leftPt,5);
  expect(f.y*.75,`${name} ${i} y`).toBeCloseTo(r.topPt,5);
  expect(f.width*.75).toBeCloseTo(r.widthPt,5);expect(f.height*.75).toBeCloseTo(r.heightPt,5);
  expect(imageAtPoint(placed,f.page,f.x+4,f.y+4)?.image.id).toBe(f.image.id);
 }
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(unzipSync(bytes));
 doc.select(0);doc.replace('Edited ');
 const exported=await save(),reopened=await DocxPackage.open(exported);
 expect(reopened.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image.anchor)).toEqual(doc.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image.anchor));
 doc.undo();expect(unzipSync(await save())).toEqual(unzipSync(bytes));
},30000);
