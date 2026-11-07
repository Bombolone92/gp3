import {assertPackageParts} from './helpers/assert-package-parts.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutShapeText} from '../src/engine/shape-text-layout.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/hidden-outline-text/',source=readFileSync(root+'control.docx'),refs=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains explicit and theme-derived invisible line widths for text geometry without adding an outline',async()=>{
 const p=await DocxPackage.open(source);expect(scenes(p)).toHaveLength(36);
 for(const [i,s] of scenes(p).entries()){
  const ref=refs.cases[i];expect(s.outline).toBeNull();expect(s.text.outlineWidth??0).toBe(ref.width*12700);
  const measure=()=>({width:40,ascent:60,descent:15});const layout=layoutShapeText(s,measure);
  const plain=layoutShapeText({...s,text:{...s.text,outlineWidth:0}},measure);
  expect(layout.left-plain.left).toBeCloseTo(ref.width*2/3,8);
  expect(layout.clip.width-plain.clip.width).toBeCloseTo(-ref.width*4/3,8);
 }
});
it.each(['-1','invalid'])('rejects invalid active invisible text-frame width %s',async width=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('w="76200"',`w="${width}"`));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('keeps atomic drawing markup and all unrelated parts across body editing, export, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),original=unzipSync(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 assertPackageParts(unzipSync(await save()),original);d.select(0);d.replace('Edited ');
 const stable=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='id'&&typeof v==='string'&&/^p[0-9]+$/.test(v)?undefined:v));
 const saved=await save();expect(stable(scenes(await DocxPackage.open(saved)))).toEqual(stable(scenes(p)));
 const parts=unzipSync(saved);expectBodyEditParts(parts,original);
 d.undo();assertPackageParts(unzipSync(await save()),original);
});
