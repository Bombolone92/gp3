import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
const folder='tests/fixtures/paragraph-end-typing',reference=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const format=r=>({bold:r?.bold===true,italic:r?.italic===true,boldCs:r?.boldCs===true,color:r?.color||'auto'});
const raw=r=>({bold:['1','true','on'].includes(r.b),italic:['1','true','on'].includes(r.i),boldCs:['1','true','on'].includes(r.bCs),color:r.color||'auto'});
const semantics=d=>d.paragraphs.map(p=>({text:paragraphText(p),inTable:!!p.cellId,mark:format(p.markFormat),runs:p.runs.map(r=>({text:r.text,format:format(r)}))}));
const native=stage=>stage.paragraphs.map(p=>({text:p.text,inTable:p.inTable,mark:raw(p.mark),runs:p.runs.map(r=>({text:r.text,format:raw(r.properties)}))}));

it.each(reference.cases)('matches native formatting and subsequent Enter typing: $fixture',async ref=>{
 const source=readFileSync(`${folder}/${ref.fixture}.docx`),pkg=await DocxPackage.open(source),d=model(pkg),parts=unzipSync(source);
 expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);expect(unzipSync(await save(pkg,d))).toEqual(parts);
 let steps=0;
 if(ref.fixture!=='body'){
  const start=d.text.indexOf('Styled tail');d.select(start,start+11);d.toggleBold();steps++;
  expect(semantics(d)).toEqual(native(ref.beforeEnter||ref.afterFormat));
 }
 if(ref.fixture!=='partial-body'){
  d.select(paragraphText(d.paragraphs[0]).length);d.insertParagraph();d.replace('Added paragraph');steps+=2;
 }
 const expected=native(ref.after||ref.afterFormat);expect(semantics(d)).toEqual(expected);
 const exported=await save(pkg,d),reopened=await DocxPackage.open(exported);expect(semantics(model(reopened))).toEqual(expected);
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(unzipSync(exported)[name],name).toEqual(bytes);
 for(let i=0;i<steps;i++)d.undo();expect(unzipSync(await save(pkg,d))).toEqual(parts);
 for(let i=0;i<steps;i++)d.redo();expect(semantics(d)).toEqual(expected);expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(exported));
});
it('updates whole paragraph marks for a backward selection without affecting adjacent marks',async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/toggle-cell.docx`)),d=model(pkg),sentinel=format(d.paragraphs[1].markFormat);
 d.select(11,0);d.toggleBold();expect(format(d.paragraphs[0].markFormat)).toEqual({bold:true,italic:true,boldCs:true,color:'auto'});
 expect(format(d.paragraphs[1].markFormat)).toEqual(sentinel);expect(d.selection).toEqual({anchor:11,focus:0});
});
