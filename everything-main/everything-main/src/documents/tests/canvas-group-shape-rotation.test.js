import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/group-shape-rotation.docx');
const scenes=p=>Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene);
it('retains nested rotations, flips and custom paths through editing and exact undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p),pictures=before.map(s=>s.children[0].children[0]);
 expect(pictures).toHaveLength(16);
 expect(pictures.map(s=>s.shapeRotation||0)).toEqual([0,1800000,2699940,2700000,2700060,5400000,8100000,10800000,13500000,16200000,18900000,19800000,1800000,5400000,1800000,10800000]);
 expect(pictures[12].flipH).toBe(true);expect(pictures[13].flipV).toBe(true);
 expect(pictures[14].paths).toHaveLength(1);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edited ');
 const edited=await save();expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 for(const [name,data] of Object.entries(unzipSync(edited)))if(name!=='word/document.xml')expect(data).toEqual(p.parts[name]);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it.each([
 ['rot="1800000"','rot="2147483648"'],
 ['rot="1800000"','rot="1.5"'],

])('continues to reject malformed shape rotations %s',async(before,after)=>{
 const p=unzipSync(source);p['word/document.xml']=strToU8(strFromU8(p['word/document.xml']).replaceAll(before,after));
 await expect(DocxPackage.open(zipSync(p))).rejects.toThrow();
});

it('accepts reflected groups and retains visible rotated shape text',async()=>{
 for(const variant of ['group','text']){
  const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const a='http://schemas.openxmlformats.org/drawingml/2006/main',wps='http://schemas.microsoft.com/office/word/2010/wordprocessingShape',w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  if(variant==='group')xml.getElementsByTagNameNS(a,'xfrm')[0].setAttribute('flipH','1');
  else{
   const shape=xml.getElementsByTagNameNS(wps,'wsp')[1],box=xml.createElementNS(wps,'wps:txbx'),content=xml.createElementNS(w,'w:txbxContent');
   const p=xml.createElementNS(w,'w:p'),r=xml.createElementNS(w,'w:r'),t=xml.createElementNS(w,'w:t');t.textContent='Visible rotated text';r.appendChild(t);p.appendChild(r);content.appendChild(p);box.appendChild(content);shape.insertBefore(box,shape.lastElementChild);
  }
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  if (variant === 'group') expect(scenes(await DocxPackage.open(zipSync(parts)))[0].flipH).toBe(true);
  else expect(JSON.stringify(scenes(await DocxPackage.open(zipSync(parts))))).toContain('Visible rotated text');
 }
});
