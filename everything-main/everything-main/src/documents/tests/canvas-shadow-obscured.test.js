import { it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom=new JSDOM(''); globalThis.DOMParser=dom.window.DOMParser; globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source=readFileSync('public/fixtures/shadow-obscured.docx');
const A='http://schemas.openxmlformats.org/drawingml/2006/main', A14='http://schemas.microsoft.com/office/drawing/2010/main';
const parse=bytes=>new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');
const flags=xml=>[...xml.getElementsByTagNameNS(A14,'shadowObscured')];
const change=fn=>{const parts=unzipSync(source),xml=parse(source);fn(xml);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const signature=bytes=>flags(parse(bytes)).map(n=>[n.parentNode.parentNode.parentNode.localName,n.hasAttribute('val')?n.getAttribute('val'):null]);
const scenes=p=>JSON.parse(JSON.stringify(Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene),(key,value)=>['id','shell'].includes(key)?undefined:value));
it.each([null,'true','false','0','1',' \ttrue\r\n'])('accepts the published boolean form %s without changing shadow-free scenes',async value=>{
 const plain=await DocxPackage.open(change(xml=>flags(xml).forEach(n=>n.parentNode.parentNode.remove())));
  const p=await DocxPackage.open(change(xml=>flags(xml).forEach(n=>value===null?n.removeAttribute('val'):n.setAttribute('val',value))));
  expect(scenes(p)).toEqual(scenes(plain));
});
it('retains flags during picture transforms, surrounding edits, export/reopen and complete undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),original=d.text;
 d.select(0);d.replace('Edited ');
 const at=d.text.indexOf('\ufffc');d.select(at,at+1);expect(d.selectedImage.kind).not.toBe('shape');
 d.setImageProperties({width:d.selectedImage.width*2,height:d.selectedImage.height*2,flipH:true,crop:{left:1000,right:0,top:0,bottom:0}});
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));expect(reopened.text).toBe(d.text);expect(signature(bytes)).toEqual(signature(source));
 const out=unzipSync(bytes);expectBodyEditParts(out,p.parts);
 while(d.history.length)d.undo();expect(d.text).toBe(original);const restored=unzipSync(await save(p,d));for(const [name,data] of Object.entries(p.parts))expect(Buffer.from(restored[name]).equals(Buffer.from(data)),name).toBe(true);
});
it.each(['boolean','unknownAttribute','nested','wrongNamespace','wrongURI','duplicateFlag','duplicateExtension','visibleEffect'])('rejects unsupported or malformed shadow metadata: %s',async kind=>{
 for(const parent of ['pic','wps']){
  const bytes=change(xml=>{
   const n=flags(xml).find(n=>n.parentNode.parentNode.parentNode.prefix===parent),ext=n.parentNode,list=ext.parentNode,properties=list.parentNode;
   if(kind==='boolean')n.setAttribute('val','yes');
   if(kind==='unknownAttribute')n.setAttribute('future','true');
   if(kind==='nested')n.append(xml.createElementNS(A14,'a14:future'));
   if(kind==='wrongNamespace')n.replaceWith(xml.createElementNS(A,'a:shadowObscured'));
   if(kind==='wrongURI')ext.setAttribute('uri','{00000000-0000-0000-0000-000000000000}');
   if(kind==='duplicateFlag')ext.append(n.cloneNode(true));
   if(kind==='duplicateExtension')list.append(ext.cloneNode(true));
   if(kind==='visibleEffect'){const effects=xml.createElementNS(A,'a:effectLst');effects.append(xml.createElementNS(A,'a:outerShdw'));properties.insertBefore(effects,list);}
  });
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
 }
});
