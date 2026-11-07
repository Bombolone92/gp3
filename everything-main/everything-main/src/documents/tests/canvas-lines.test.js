import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const source=readFileSync('public/fixtures/preset-lines.docx'),A='http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const shape=n=>n.type==='group'?shape(n.children[0]):n;
it('reads flat, diagonal and nested lines with physical stroke units and no fill',async()=>{
 const p=await DocxPackage.open(source),s=Object.values(p.assets).map(a=>shape(a.scene));
 expect(s).toHaveLength(8);expect(s[1].height).toBe(0);expect(s[2].width).toBe(0);
 for(const n of s)expect(n.paths[0]).toEqual({width:1,height:1,points:[['M',0,0],['L',1,1]],fill:false,stroke:true,physicalStroke:true});
 expect(s[7].outline).toBeNull();
});
it('retains zero extents and all line declarations through atomic deletion, text edit, reopen and undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('Edited ');const at=d.text.indexOf('\ufffc');d.select(at,at+1);expect(()=>d.setImageProperties({width:100})).toThrow(/complete objects/);d.replace('');d.undo();
 const reopened=await DocxPackage.open(await save());expect(Object.values(reopened.assets).map(a=>a.scene)).toEqual(Object.values(p.assets).map(a=>a.scene));
 while(d.history.length)d.undo();const out=unzipSync(await save());for(const [name,data] of Object.entries(p.parts))expect(Buffer.from(out[name]).equals(Buffer.from(data)),name).toBe(true);
});
it.each(['zero-rect','negative','zero-both','adjusted','invalid-angle'])('retains guards for %s',async kind=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const line=xml.getElementsByTagNameNS(A,'prstGeom')[1],props=line.parentElement,ext=props.getElementsByTagNameNS(A,'ext')[0];
 if(kind==='zero-rect')line.setAttribute('prst','rect');if(kind==='negative')ext.setAttribute('cx','-1');if(kind==='zero-both')ext.setAttribute('cx','0');if(kind==='invalid-angle')props.getElementsByTagNameNS(A,'xfrm')[0].setAttribute('rot','1.5');
 if(kind==='adjusted'){const gd=xml.createElementNS(A,'a:gd');gd.setAttribute('name','adj');gd.setAttribute('fmla','val 100');line.firstElementChild.append(gd);}
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it('accepts a rotated flat line without changing its retained source declarations',async()=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const props=xml.getElementsByTagNameNS(A,'prstGeom')[1].parentElement;
 props.getElementsByTagNameNS(A,'xfrm')[0].setAttribute('rot','60000');
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const pkg=await DocxPackage.open(zipSync(parts));
 expect(shape(Object.values(pkg.assets)[1].scene)).toMatchObject({lineRotation:60000,height:0});
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(parts);
});
