import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage,createDocx} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {pageBorderStrokes,pageBorderWidth} from '../src/engine/page-borders.js';
const folder='tests/fixtures/page-borders',source=readFileSync(`${folder}/control.docx`),refs=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const revise=change=>{const p=unzipSync(source);p['word/document.xml']=strToU8(change(strFromU8(p['word/document.xml'])));return zipSync(p);};
it('retains independently recorded source and native reference PDF hashes',()=>{for(const ref of Object.values(refs))for(const[n,h]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);});
it('retains native page-border hairlines and large authored widths',async()=>{
 const p=await DocxPackage.open(readFileSync(`${folder}/widths.docx`));
 const borders=[...p.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd.pageBorders.borders.top),p.pageSettings.pageBorders.borders.top];
 expect(borders.map(b=>b.size)).toEqual([0,0,1,2,4,8,96,200]);
 borders.forEach(b=>expect(pageBorderWidth(b)).toBeCloseTo(Math.max(1,Math.floor(b.size*25/24))*.16,8));
 const q=createDocx([paragraph('Large border')],{pageBorders:{borders:{top:borders.at(-1)}}});expect((await DocxPackage.open(await save(q,model(q)))).pageSettings.pageBorders.borders.top.size).toBe(200);
});
it('preserves all section borders through editing, export, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p);expect(unzipSync(await save(p,d))).toEqual(p.parts);
 const settings=doc=>[...doc.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd.pageBorders),doc.pageSettings.pageBorders];
 expect(settings(p)).toHaveLength(12);d.select(0);d.replace('Edited ');const edited=await save(p,d),out=unzipSync(edited);expect(settings(await DocxPackage.open(edited))).toEqual(settings(p));
 for(const n of Object.keys(p.parts))if(n!=='word/document.xml')expect(out[n]).toEqual(p.parts[n]);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('authors, edits and removes borders without moving writing margins',async()=>{
 const border={style:'single',size:48,space:24,color:'123456'},pageBorders={offsetFrom:'page',display:'allPages',zOrder:'front',borders:{top:border,left:border,bottom:border,right:border}};
 const p=createDocx([paragraph('Border')],{pageBorders}),d=model(p);expect((await DocxPackage.open(await save(p,d))).pageSettings.pageBorders).toEqual(p.pageSettings.pageBorders);
 const g=pageGeometry(d.pageSettings);expect(g.left).toBe(96);expect(pageBorderStrokes(g)[0]).toMatchObject({x:32,y:32,height:8,width:752});
 d.setPageSettings({pageBorders:{...pageBorders,offsetFrom:'text',display:'notFirstPage'}});expect(pageBorderStrokes(pageGeometry(d.pageSettings),0)).toEqual([]);expect(pageBorderStrokes(pageGeometry(d.pageSettings),1)[0]).toMatchObject({x:56,y:56,height:8,width:704});
 expect((await DocxPackage.open(await save(p,d))).pageSettings.pageBorders.offsetFrom).toBe('text');d.undo();expect(d.pageSettings.pageBorders.offsetFrom).toBe('page');
 d.setPageSettings({pageBorders:null});expect(strFromU8(unzipSync(await save(p,d))['word/document.xml'])).not.toContain('pgBorders');
});
it('rejects malformed, art and shadow borders before editable open',async()=>{
 for(const [a,b]of [['w:offsetFrom="page"','w:offsetFrom="oops"'],['w:zOrder="front"','w:zOrder="middle"'],['w:display="allPages"','w:display="everyOther"'],['w:val="single"','w:val="apples"'],['w:sz="48"','w:sz="bogus"'],['w:space="24"','w:space="32"'],['w:color="000000"','w:color="oops"'],['w:val="single"','w:val="single" w:shadow="1"']]){
  const bytes=revise(xml=>xml.replace(a,b));await expect(DocxPackage.open(bytes)).rejects.toMatchObject({name:'UnsupportedDocumentError'});expect((await DocxPackage.open(bytes,{bestEffort:true})).readOnly).toBe(true);
 }
});
it('retains header/footer exclusion settings and initializes them in new packages',async()=>{
 for(const name of ['stories','exclude-header','exclude-footer','exclude-both']){
  const p=await DocxPackage.open(readFileSync(`${folder}/${name}.docx`)),d=model(p);
  expect(p.pageSettings.bordersDoNotSurroundHeader).toBe(['exclude-header','exclude-both'].includes(name));expect(p.pageSettings.bordersDoNotSurroundFooter).toBe(['exclude-footer','exclude-both'].includes(name));
  d.select(0);d.replace('Edited ');const q=await DocxPackage.open(await save(p,d));expect(q.pageSettings).toEqual(p.pageSettings);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
 }
 const p=createDocx([paragraph('New')],{bordersDoNotSurroundHeader:true,bordersDoNotSurroundFooter:true});expect((await DocxPackage.open(await save(p,model(p)))).pageSettings.bordersDoNotSurroundFooter).toBe(true);
});
