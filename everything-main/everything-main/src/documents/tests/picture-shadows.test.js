import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { paintPictureShadow } from '../src/engine/canvas-picture-shadow.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source = readFileSync('tests/fixtures/picture-shadows/source.docx');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const scaledSource = readFileSync('tests/fixtures/scaled-picture-shadows/source.docx');
it('rejects excessive scaled bitmap bounds before allocation and releases the source',()=>{
 let closed=false;
 const source={left:0,top:0,width:100,height:100,frameWidth:100,frameHeight:100,close(){closed=true;}};
 expect(()=>paintPictureShadow(source,{scaleX:1000,scaleY:1,blur:0,x:0,y:0},'rect')).toThrow(/resource limit/);
 expect(closed).toBe(true);
});
let dom;
beforeAll(() => { dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => { dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer; });
const shadows = p => p.paragraphs.flatMap(par => par.runs.filter(r=>r.image).map(r=>p.assets[r.image.assetId].shadow));
const same = (a,b) => {expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const n of Object.keys(b))expect(Buffer.from(a[n]).equals(Buffer.from(b[n])),n).toBe(true);};
it('retains physical offsets, blur, color alpha and the current false obscuration default',async()=>{
 const p=await DocxPackage.open(source),s=shadows(p);expect(s).toHaveLength(20);expect(s[0]).toBeUndefined();
 expect(s[1]).toMatchObject({blur:0,x:16,y:0,color:{rgb:'000000',alpha:.4},obscured:false});
 expect(s[2].blur).toBeCloseTo(16/3);expect(s[4].x).toBeCloseTo(-16);expect(s[5].y).toBeCloseTo(16);
 expect(s[11].obscured).toBe(true);expect(s[12].obscured).toBe(false);expect(s[16].obscured).toBe(false);
 expect(s[19].color.rgb).toBe('8040C0');
});
it('imports all scale anchors, signed scales and collapsed shadows',async()=>{
 const s=shadows(await DocxPackage.open(scaledSource));
 expect(s.slice(0,9).map(v=>v.alignment)).toEqual(['tl','t','tr','l','ctr','r','bl','b','br']);
 for(const v of s.slice(0,9))expect(v).toMatchObject({scaleX:1.5,scaleY:.5});
 expect(s[10].scaleX).toBe(-1);expect(s[11].scaleY).toBe(-1);expect(s[12].scaleX).toBe(0);
 expect(s[13]).toMatchObject({scaleX:1.02,scaleY:1.02,blur:48,alignment:'ctr'});
});
it('preserves all scaled shadow declarations through body editing, export and exact undo',async()=>{
 const p=await DocxPackage.open(scaledSource),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 same(unzipSync(await save()),p.parts);d.select(0);d.replace('Edit ');
 const reopened=await DocxPackage.open(await save());expect(shadows(reopened)).toEqual(shadows(p));
 expectBodyEditParts(reopened.parts,p.parts);
 d.undo();same(unzipSync(await save()),p.parts);
});
it.each(['150000','150%','150.0%'])('accepts schema percentage %s and the bottom alignment default',async value=>{
 const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const shadow=doc.getElementsByTagNameNS(A,'outerShdw')[0];shadow.setAttribute('sx',value);shadow.removeAttribute('algn');
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 expect(shadows(await DocxPackage.open(zipSync(parts)))[1]).toMatchObject({scaleX:1.5,scaleY:1,alignment:'b'});
});
it('preserves effect XML, unrelated package parts and exact undo after a surrounding edit',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 same(unzipSync(await save()),p.parts);d.select(0);d.replace('Edit ');
 const reopened=await DocxPackage.open(await save());expect(shadows(reopened)).toEqual(shadows(p));
 expectBodyEditParts(reopened.parts,p.parts);
 d.undo();same(unzipSync(await save()),p.parts);
});
it('does not activate shadow flags buried inside an inactive saved fill',async()=>{
 const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const shape=doc.getElementsByTagNameNS(A,'outerShdw')[0].parentElement.parentElement;
 const A14='http://schemas.microsoft.com/office/drawing/2010/main';
 const add=(p,ns,name,attrs={})=>{const n=doc.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);p.append(n);return n;};
 const saved=add(add(add(shape,A,'a:extLst'),A,'a:ext',{uri:'{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}'}),A14,'a14:hiddenFill');
 const fill=add(saved,A,'a:blipFill'),blip=add(fill,A,'a:blip');
 add(add(add(blip,A,'a:extLst'),A,'a:ext',{uri:'urn:inactive-vendor-metadata'}),A14,'a14:shadowObscured',{val:'1'});
 add(add(fill,A,'a:stretch'),A,'a:fillRect');
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 expect(shadows(await DocxPackage.open(zipSync(parts)))[1].obscured).toBe(false);
});
it.each([['blurRad','-1'],['dist','NaN'],['dir','21600000'],['sx','NaN'],['ky','60000'],['rotWithShape','maybe'],['algn','unknown'],['unexpected','1']])('guards unsupported or invalid %s=%s',async(key,value)=>{
 const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 doc.getElementsByTagNameNS(A,'outerShdw')[0].setAttribute(key,value);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/shadow/);
});
