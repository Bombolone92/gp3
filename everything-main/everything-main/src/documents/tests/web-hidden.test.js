import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const bytes=readFileSync('public/fixtures/web-hidden.docx');let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('retains web-view declarations through editing visible text, formatting, reopening and undo',async()=>{
 const p=await DocxPackage.open(bytes),d=model(p);
 expect(d.paragraphs).toHaveLength(7);expect(unzipSync(await save(p,d))).toEqual(p.parts);
 const at=d.text.indexOf('Direct web hidden text');d.select(at+7,at+7);const original=d.snapshot();d.replace('EDIT ');
 d.select(at,at+6);d.setRunFormat({bold:true});
 const out=await save(p,d),parts=unzipSync(out),reopened=model(await DocxPackage.open(out));
 expect(reopened.text).toBe(d.text);
 const direct=reopened.paragraphs[1];expect(direct.runs.every(r=>r.properties?.includes('webHidden'))).toBe(true);
 for(const name of Object.keys(p.parts))if(name!=='word/document.xml')expect(parts[name],name).toEqual(p.parts[name]);
 d.undo();d.undo();expect(d.snapshot()).toEqual(original);expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each(['w:val="yes"','w:val="2"','w:val="TRUE"'])('guards malformed webHidden %s',async attr=>{
 const parts=unzipSync(bytes);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:webHidden/>',`<w:webHidden ${attr}/>`));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it.each(['<w:webHidden/><w:webHidden/>','<w:webHidden>invalid</w:webHidden>','<w:webHidden w:extra="1"/>'])('guards duplicate or unsupported declaration content %s',async markup=>{
 const parts=unzipSync(bytes);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:webHidden/>',markup));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
