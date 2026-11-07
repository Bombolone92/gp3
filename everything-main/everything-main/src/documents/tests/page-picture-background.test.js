import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {pageGeometry,validatePageSettings} from '../src/engine/page-settings.js';
import {layoutDocument} from '../src/engine/layout.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/page-picture-background/',references=JSON.parse(readFileSync(root+'reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const hash=b=>createHash('sha256').update(b).digest('hex');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const same=(bytes,parts,edited=false)=>{const out=unzipSync(bytes);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edited){expectBodyEditParts(out,parts);return;}for(const[n,b]of Object.entries(parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
it.each(references)('retains $name and matches native physical repetition through editing',async ref=>{
 const source=readFileSync(root+ref.name+'.docx');expect(hash(source)).toBe(ref.sourceSha256);expect(hash(readFileSync(root+ref.name+'-native.pdf'))).toBe(ref.pdfSha256);
 const p=await DocxPackage.open(source),d=model(p),picture=d.pageSettings.backgroundPicture,parts=unzipSync(source);
 expect(picture.assetId).toBe('word/media/background.png');expect(picture.width).toBeCloseTo(ref.width,2);expect(picture.height).toBeCloseTo(ref.height,2);
 expect(pageGeometry(d.pageSettings).backgroundPicture).toEqual(picture);same(await save(p,d),parts);
 d.select(0);d.replace('Added ');const edited=await save(p,d);same(edited,parts,true);
 const reopened=await DocxPackage.open(edited);expect(reopened.pageSettings.backgroundPicture).toEqual(picture);expect(model(reopened).text).toBe(d.text);
 d.undo();same(await save(p,d),parts);
 d.setPageSettings({left:d.pageSettings.left+120});expect(d.pageSettings.backgroundPicture).toEqual(picture);expect((await DocxPackage.open(await save(p,d))).pageSettings.backgroundPicture).toEqual(picture);
 d.undo();same(await save(p,d),parts);
 d.setPageSettings({background:'ABCDEF'});expect(d.pageSettings.backgroundPicture).toBeNull();const solid=await DocxPackage.open(await save(p,d));expect(solid.pageSettings.background).toBe('ABCDEF');expect(solid.pageSettings.backgroundPicture).toBeNull();
 d.undo();same(await save(p,d),parts);
 d.setPageSettings({backgroundPicture:null});expect((await DocxPackage.open(await save(p,d))).pageSettings.backgroundPicture).toBeNull();d.undo();same(await save(p,d),parts);
});
it('applies the document background across section boundaries without changing layout',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'frame96.docx')),d=model(p);
 d.paragraphs[0].sectionEnd={...d.pageSettings,background:'123456',backgroundPicture:null,left:720};
 const measure=t=>({width:t.length*7,ascent:12,descent:3});
 const withPicture=layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
 const plain=layoutDocument(d.paragraphs,measure,pageGeometry({...d.pageSettings,backgroundPicture:null}),d.numbering,d.tables);
 expect(withPicture.pages.length).toBeGreaterThan(1);
 for(const page of withPicture.pages){expect(page.backgroundPicture).toEqual(d.pageSettings.backgroundPicture);expect(page.background).toBe('#FFFFFF');}
 expect(withPicture.lines.map(l=>[l.page,l.y,l.height])).toEqual(plain.lines.map(l=>[l.page,l.y,l.height]));
});
it.each(['gradient','opacity','external','missing','content-type'])('keeps unsupported %s backgrounds guarded',async kind=>{
 const parts=unzipSync(readFileSync(root+'frame96.docx'));
 if(kind==='gradient')parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('type="frame"','type="gradient"'));
 if(kind==='opacity')parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('type="frame"','type="frame" opacity="0.5"'));
 if(kind==='external')parts['word/_rels/document.xml.rels']=strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('Target="media/background.png"','TargetMode="External" Target="https://example.invalid/background.png"'));
 if(kind==='missing')delete parts['word/media/background.png'];
 if(kind==='content-type')parts['[Content_Types].xml']=strToU8(strFromU8(parts['[Content_Types].xml']).replace('image/png','image/svg+xml'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('rejects invalid background geometry and unsupported picture creation',async()=>{
 for(const value of [{assetId:'x',width:0,height:1},{assetId:'x',width:1,height:Infinity},{assetId:'x',width:1,height:1,extra:true}])expect(()=>validatePageSettings({backgroundPicture:value})).toThrow();
 const p=await DocxPackage.open(readFileSync(root+'frame96.docx')),d=model(p);
 expect(()=>d.setPageSettings({backgroundPicture:{assetId:'new',width:12,height:12}})).toThrow();
 expect(d.setPageSettings({left:d.pageSettings.left})).toBe(false);
});
