import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { hasLineText } from '../src/engine/line-whitespace.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/inline-picture-whitespace/';
const cases=JSON.parse(readFileSync(root+'cases.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const measure=(t,s)=>({width:t.length*4,ascent:s.fontSize,descent:s.fontSize/3});
const layout=doc=>layoutDocument(doc.paragraphs,measure,pageGeometry(doc.pageSettings));

it.each(['source','text-only','source-explicit','text-only-explicit'])('pins native source/PDF capture: %s',name=>{
 const ref=JSON.parse(readFileSync(root+name+'-reference.json'));
 for(const [file,hash]of [[name+'.docx',ref.sourceSha256],[(name==='source'?'native':name+'-native')+'.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
});
it('classifies blank characters according to paragraph-mark sensitivity, not Unicode trimming',()=>{
 const ref=JSON.parse(readFileSync(root+'text-only-reference.json')),half=cases.length/2;
 for(let i=0;i<half;i++){
  expect(cases[i].text).toBe(cases[i+half].text);
  const markControlsHeight=Math.abs(ref.pages[i].After-ref.pages[i+half].After)>1;
  expect(!hasLineText(cases[i].text),cases[i].name).toBe(markControlsHeight);
 }
});
it('retains a descender for nonbreaking spaces and restores ordinary-space metrics after undo',async()=>{
 const pkg=await DocxPackage.open(readFileSync(root+'source.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 const pictureLine=l=>l.lines.find(l=>l.page===1&&l.fragments.some(f=>f.image));
 const original=pictureLine(layout(doc));
 const p=doc.paragraphs[6],at=doc.paragraphs.slice(0,6).reduce((n,p)=>n+p.runs.reduce((n,r)=>n+r.text.length,0)+1,0)+1;
 expect(p.runs.map(r=>r.text).join('')).toBe('\ufffc ');
 doc.select(at,at+1);doc.replace('\u00a0');
 expect(pictureLine(layout(doc)).height-original.height).toBeCloseTo(10/3,8);
 const edited=await save(),parts=unzipSync(edited),reopened=await DocxPackage.open(edited);
 expect(reopened.paragraphs[6].runs.map(r=>r.text).join('')).toBe('\ufffc\u00a0');
 expectBodyEditParts(parts,pkg.parts);
 doc.undo();expect(pictureLine(layout(doc)).height).toBe(original.height);
 const undo=unzipSync(await save());for(const n in pkg.parts)expect(undo[n]).toEqual(pkg.parts[n]);
},60000);
