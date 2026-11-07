import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const fixture=()=>unzipSync(readFileSync('public/fixtures/font-alternatives.docx'));
const missing='AltProbeMissing73';
it('reads alternative names through the font-table relationship without replacing declarations or rewriting retained parts',async()=>{
 const source=fixture(),p=await DocxPackage.open(zipSync(source));
 expect(p.styles.fontAlternatives[missing.toLowerCase()]).toEqual(['Arial','Calibri']);expect(p.paragraphs[0].runs[0].fontAscii).toBe(missing);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
 expect(await save()).toEqual(source);d.select(0);d.replace('Edited ');const edited=await save();
 for(const name of Object.keys(source))if(name!=='word/document.xml')expect(edited[name]).toEqual(source[name]);
 const reopened=await DocxPackage.open(zipSync(edited));expect(reopened.styles.fontAlternatives).toEqual(p.styles.fontAlternatives);expect(reopened.paragraphs[0].runs[0].fontAscii).toBe(missing);
 d.undo();expect(await save()).toEqual(source);
});
it.each(['<w:altName/>','<w:altName w:val=""/>','<w:altName w:val="Arial"/><w:altName w:val="Calibri"/>'])('rejects invalid alternative declarations: %s',async markup=>{
 const parts=fixture();parts['config/fonts2.xml']=strToU8(strFromU8(parts['config/fonts2.xml']).replace('<w:altName w:val="Arial"/>',markup));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
