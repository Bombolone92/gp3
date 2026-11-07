import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {deviceTableBorders} from '../src/engine/border-device-layout.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const root='tests/fixtures/table-grid-phase/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ctx={getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),canvas:{width:1056}};
for(const fixture of ['control','holdout']) {
 const source=readFileSync(root+fixture+'.docx'),ref=JSON.parse(readFileSync(root+fixture+'-reference.json'));
 it(`${fixture}: preserves source geometry while matching all native horizontal grid bands`,async()=>{
  expect(sha(source)).toBe(ref.sourceSha256);
  expect(sha(readFileSync(root+fixture+'-native-screen.png'))).toBe(ref.nativeCropSha256);
  expect(sha(readFileSync(root+(fixture==='control'?'cases':'holdout-cases')+'.json'))).toBe(ref.casesSha256);
  const p=await DocxPackage.open(source);
  const l=layoutDocument(p.paragraphs,()=>({width:0,ascent:1,descent:0}),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
  const original=JSON.stringify(l.tableBorders),screen=deviceTableBorders(ctx,l.tableBorders),physical=deviceTableBorders(ctx,l.tableBorders,true,pageGeometry(p.pageSettings));
  for(const table of ref.tables){
   const bands=screen.filter(s=>!s.guide&&s.horizontal&&s.x<=table.sampleX&&s.x+s.width>table.sampleX).map(s=>[s.y,s.y+s.height]);
   expect([...new Map(bands.map(b=>[b.join(':'),b])).values()].sort((a,b)=>a[0]-b[0])).toEqual(table.bands);
  }
  expect(JSON.stringify(l.tableBorders)).toBe(original);
  for(const [i,s] of l.tableBorders.entries())if(s.horizontal&&!s.guide)expect(physical[i].y).toBe(s.y);
 });
 it(`${fixture}: retains source parts, editing, reopening and exact undo`,async()=>{
  const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(unzipSync(source));
  d.selectCell(d.tables[0].rows[2].cells[0].id);d.replace('Edited grid cell');
  const bytes=await save(),reopened=await DocxPackage.open(bytes);
  expect(reopened.tables).toHaveLength(3);
  expect(reopened.paragraphs.flatMap(p=>p.runs).map(r=>r.text).join('')).toContain('Edited grid cell');
  for(const [name,part] of Object.entries(unzipSync(source)))if(name!=='word/document.xml')expect(unzipSync(bytes)[name]).toEqual(part);
  d.undo();expect(unzipSync(await save())).toEqual(unzipSync(source));
 });
}

it('mixed-height 75 percent holdout retains all native bands including minimum bottom ink',async()=>{
 const source=readFileSync(root+'holdout.docx'),ref=JSON.parse(readFileSync(root+'holdout-reference-75.json'));
 expect(sha(source)).toBe(ref.sourceSha256);expect(sha(readFileSync(root+'holdout-native-screen-75.png'))).toBe(ref.nativeCropSha256);
 const p=await DocxPackage.open(source),l=layoutDocument(p.paragraphs,()=>({width:0,ascent:1,descent:0}),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
 const screen=deviceTableBorders({getTransform:()=>({a:.75,b:0,c:0,d:.75,e:0,f:0}),canvas:{width:792}},l.tableBorders);
 for(const table of ref.tables){const bands=screen.filter(s=>!s.guide&&s.horizontal&&s.x*.75<=table.sampleX&&(s.x+s.width)*.75>table.sampleX).map(s=>[Math.round(s.y*.75),Math.round((s.y+s.height)*.75)]);expect([...new Map(bands.map(b=>[b.join(':'),b])).values()].sort((a,b)=>a[0]-b[0])).toEqual(table.bands);}
});
