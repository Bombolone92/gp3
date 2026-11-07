import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {assertPackageParts} from './helpers/assert-package-parts.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/text-fill-alpha/',source=readFileSync(root+'control.docx');
const ref=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const fills=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.text.startsWith('MWAV')).map(r=>r.textFill));
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('reads paired body/WPS opacity with transparency inversion, quantization and last-alpha precedence',async()=>{
 for(const[n,h]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(root+n)).digest('hex')).toBe(h);
 const p=await DocxPackage.open(source),body=fills(p),shapes=Object.values(p.assets).map(a=>fills(a.scene.text)[0]);
 expect(body).toHaveLength(12);expect(shapes).toEqual(body);
 expect(body.slice(0,10)).toEqual(['C02040','C02040','C02040BF','C020407F','C0204066','C020404C','C0204000','C0204000','C020404C','C02040BF']);
 expect(body[10]).toBe(body[11]);expect(body[10].slice(6)).toBe('66');
 const d=model(p);assertPackageParts(unzipSync(await save(p,d)),p.parts);d.select(0);d.replace('Edit ');
 const bytes=await save(p,d),again=await DocxPackage.open(bytes);expect(fills(again)).toEqual(body);
 expectBodyEditParts(unzipSync(bytes),p.parts);
 d.undo();assertPackageParts(unzipSync(await save(p,d)),p.parts);
});
it('serializes edited translucent fills and preserves ordinary foreground edits',async()=>{
 const p=await DocxPackage.open(source),d=model(p),at=d.text.indexOf('MWAV body');d.select(at,at+9);d.setRunFormat({textFill:'20802080'});
 let again=await DocxPackage.open(await save(p,d));expect(fills(again)[0]).toBe('20802080');
 d.setRunFormat({color:'FF0000'});again=await DocxPackage.open(await save(p,d));expect(fills(again)[0]).toBe('20802080');
 d.undo();d.undo();assertPackageParts(unzipSync(await save(p,d)),p.parts);
});
it.each(['-1','100001','NaN','1.5','50%',''])('rejects invalid W14 alpha %s',async raw=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const ns='http://schemas.microsoft.com/office/word/2010/wordml';
 xml.getElementsByTagNameNS(ns,'alpha')[0].setAttributeNS(ns,'w14:val',raw);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});

it('keeps eight-digit display colors separate from six-digit OOXML srgbClr values',async()=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const ns='http://schemas.microsoft.com/office/word/2010/wordml';xml.getElementsByTagNameNS(ns,'srgbClr')[0].setAttributeNS(ns,'w14:val','C0204080');
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
