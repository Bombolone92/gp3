import {assertPackageParts} from './helpers/assert-package-parts.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {resolveStyledParagraph} from '../src/engine/styles.js';
import {paintColor} from '../src/engine/colors.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/shape-auto-color/',source=readFileSync(root+'control.docx'),refs=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('resolves automatic text from fontRef after the style cascade while preserving explicit colors and declarations',async()=>{
 const p=await DocxPackage.open(source);expect(scenes(p)).toHaveLength(36);
 for(const [i,s] of scenes(p).entries()){
  const ref=refs.cases[i],paragraph=s.text.paragraphs[0],r=paragraph.runs[0];
  expect(paintColor(r.color,s.fill).slice(1).toUpperCase(),`case ${i+1}`).toBe(ref.nativeColor);
  if(ref.level==='direct')expect(r.directFormat.color).toBe('auto');
  if(ref.level==='explicit')expect(r.directFormat.color).toBe('0000FF');
  const again=resolveStyledParagraph(structuredClone(paragraph),p.styles,p.numbering);expect(again.runs[0].color).toBe(r.color);
 }
 expect(p.paragraphs[0].runs[0].color).not.toBe('FFFFFF');
});
it('keeps atomic drawing markup and all unrelated parts across body editing, export, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),original=unzipSync(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 assertPackageParts(unzipSync(await save()),original);d.select(0);d.replace('Edited ');
 const stable=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='id'&&typeof v==='string'&&/^p[0-9]+$/.test(v)?undefined:v));
 const saved=await save();expect(stable(scenes(await DocxPackage.open(saved)))).toEqual(stable(scenes(p)));
 expectBodyEditParts(unzipSync(saved),original);
 d.undo();assertPackageParts(unzipSync(await save()),original);
});
