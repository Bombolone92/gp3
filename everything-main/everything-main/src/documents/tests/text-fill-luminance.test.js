import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {assertPackageParts} from './helpers/assert-package-parts.js';
const root='tests/fixtures/text-fill-luminance/',source=readFileSync(root+'control.docx');
const refs=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const colors=d=>d.paragraphs.map(p=>p.runs[0].textFill);
it('matches every native fill color, including repeated transforms, style inheritance and half-byte rounding',async()=>{
 for(const[n,h]of Object.entries(refs.hashes))expect(createHash('sha256').update(readFileSync(root+n)).digest('hex'),n).toBe(h);
 const p=await DocxPackage.open(source),d=model(p);
 expect(colors(d)).toEqual(refs.cases.map(c=>c.native.color.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()));
 assertPackageParts(unzipSync(await save(p,d)),p.parts);
 d.select(0);d.replace('Edited ');const bytes=await save(p,d),out=model(await DocxPackage.open(bytes));
 expect(colors(out)).toEqual(colors(d));expect(out.text).toBe(d.text);
 const parts=unzipSync(bytes);for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);
 expect(strFromU8(parts['word/document.xml'])).toContain('w14:lumMod');
 d.undo();assertPackageParts(unzipSync(await save(p,d)),p.parts);
});
it('keeps text-effect colors through ordinary color edits and replaces them only on an explicit fill edit',async()=>{
 const p=await DocxPackage.open(source),d=model(p);d.select(8,15);d.setRunFormat({color:'FF0000'});
 let out=model(await DocxPackage.open(await save(p,d)));expect(colors(out)[1]).toBe('6C3084');
 d.setRunFormat({textFill:'ABCDEF'});out=model(await DocxPackage.open(await save(p,d)));expect(colors(out)[1]).toBe('ABCDEF');
 d.undo();d.undo();assertPackageParts(unzipSync(await save(p,d)),p.parts);
});
it.each(['NaN','1.5','2147483648','-2147483649','','75%'])('rejects unsupported or malformed luminance value %s',async raw=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('w14:val="75000"','w14:val="'+raw+'"'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it.each(['<w14:lumMod w14:val="50000" w14:unknown="1"/>','<w14:lumMod/>','<w14:lumMod w14:val="50000"><w14:lumOff w14:val="1"/></w14:lumMod>','<w14:lumMod w14:val="50000">unexpected</w14:lumMod>','<w14:tint w14:val="50000"/>'])('rejects malformed or unsupported transform %s',async transform=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w14:lumMod w14:val="75000"/>',transform));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
