import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {listMarkers} from '../src/engine/numbering.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/symbol-bullet.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('retains encoded Symbol bullets separately from Unicode bullets and their readable labels',async()=>{
 const p=await DocxPackage.open(source),markers=listMarkers(p.paragraphs,p.numbering);
 expect(markers).toHaveLength(24);expect(markers.every(m=>m.text==='•')).toBe(true);
 for(const[i,m]of markers.entries())expect(m.level.symbol).toEqual(i<8?{font:'Symbol',text:'\uf0b7',fallback:'•'}:undefined);
});
it('preserves original numbering and package parts through text edit, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=d.snapshot();d.replace('Edited ');
 const bytes=await save(p,d),out=unzipSync(bytes),reopened=await DocxPackage.open(bytes);
 expect(listMarkers(reopened.paragraphs,reopened.numbering).map(m=>m.level.symbol)).toEqual(listMarkers(p.paragraphs,p.numbering).map(m=>m.level.symbol));
 for(const[name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(Buffer.from(out[name]).equals(Buffer.from(data)),name).toBe(true);
 d.undo();expect(d.snapshot()).toEqual(before);const restored=unzipSync(await save(p,d));
 for(const[name,data]of Object.entries(p.parts))expect(Buffer.from(restored[name]).equals(Buffer.from(data)),name).toBe(true);
});
it('writes encoded glyphs when numbering is regenerated, while respecting replacement labels',async()=>{
 const p=await DocxPackage.open(source),d=model(p);
 d.numbering.abstracts['24']={...structuredClone(d.numbering.abstracts['0']),generated:true};
 let out=await save(p,d),reopened=await DocxPackage.open(out);
 expect(reopened.numbering.abstracts['24'].levels[0].symbol.text).toBe('\uf0b7');
 expect(strFromU8(unzipSync(out)['word/numbering.xml'])).toContain('w:val="\uf0b7"');
 d.numbering.abstracts['24'].levels[0].text='X';out=await save(p,d);reopened=await DocxPackage.open(out);
 expect(reopened.numbering.abstracts['24'].levels[0]).toMatchObject({text:'X'});
 expect(reopened.numbering.abstracts['24'].levels[0].symbol).toBeUndefined();
});
