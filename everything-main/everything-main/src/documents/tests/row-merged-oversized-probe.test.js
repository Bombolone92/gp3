import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {paragraphText} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('flows a merge through actual row boxes when a later oversized row moves to a fresh page',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/row-geometry/row-merged-later-15-probe.docx'));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=JSON.parse(readFileSync('tests/fixtures/row-geometry/row-merged-later-15-native-lines.json','utf8'));
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 expect(result.pageCount).toBe(expected.length);
 const leftId=result.lines.find(l=>labels.get(l.paragraphId)==='Left 000').cellId;
 for(const box of result.cells.filter(c=>c.id===leftId)){
  const neighbor=result.cells.find(c=>c.page===box.page&&c.x>box.x);
  expect(neighbor,`neighbor page ${box.page+1}`).toBeDefined();
  expect(box.y,`merged top page ${box.page+1}`).toBeCloseTo(neighbor.y);
  expect(box.height,`merged height page ${box.page+1}`).toBeCloseTo(neighbor.height);
 }
 for(let part=0;part<expected.length;part++){
  const actual=[...result.lines,...result.repeatedLines].filter(l=>l.page===part).sort((a,b)=>a.y-b.y||a.x-b.x);
  expect(actual.map(l=>labels.get(l.paragraphId)).join('').replaceAll(' ',''),`page ${part+1}`).toBe(expected[part].lines.map(l=>l.text).join('').replaceAll(' ',''));
  for(const line of actual){
   const reference=expected[part].lines.find(l=>l.text.includes(labels.get(line.paragraphId)));
   expect(Math.abs((line.baseline-actual[0].baseline)*.75-(expected[part].lines[0].y-reference.y)),labels.get(line.paragraphId)).toBeLessThan(.13);
  }
 }
});
it('reserves a resumed header above a continuing vertical merge after an oversized row',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/row-geometry/row-merged-oversized-15-probe.docx'));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=JSON.parse(readFileSync('tests/fixtures/row-geometry/row-merged-oversized-15-native-lines.json','utf8'));
 expect(result.pageCount).toBe(expected.length);
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 const header=result.repeatedLines.find(l=>l.page===3&&labels.get(l.paragraphId)==='Header');expect(header).toBeDefined();
 const continuation=result.lines.find(l=>labels.get(l.paragraphId)==='Left 053');expect(continuation.page).toBe(3);
 const reference=expected[3].lines,delta=reference.find(l=>l.text==='Header').y-reference.find(l=>l.text.includes('Left 053')).y;
 expect(Math.abs((continuation.baseline-header.baseline)*.75-delta)).toBeLessThan(.13);
 const right=result.lines.find(l=>labels.get(l.paragraphId)==='Right second');expect(right.page).toBe(3);expect(right.y).toBeCloseTo(continuation.y);
});
it('clips a legacy oversized merged owner without enlarging its following row',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/row-geometry/row-merged-oversized-14-probe.docx'));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=JSON.parse(readFileSync('tests/fixtures/row-geometry/row-merged-oversized-14-native-lines.json','utf8'));
 expect(result.pageCount).toBe(expected.length);
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 const header=result.repeatedLines.find(l=>l.page===2&&labels.get(l.paragraphId)==='Header');
 for(const text of ['Right second','Trailing','After table']){
  const actual=result.lines.find(l=>labels.get(l.paragraphId)===text);expect(actual.page,text).toBe(2);
  const reference=expected[2].lines,delta=reference.find(l=>l.text==='Header').y-reference.find(l=>l.text===text).y;
  expect(Math.abs((actual.baseline-header.baseline)*.75-delta),text).toBeLessThan(.13);
 }
 const hidden=result.lines.find(l=>labels.get(l.paragraphId)==='Left 084');
 expect(hidden.page).toBe(1);expect(hidden.cellClip).toBeDefined();expect(hidden.cellClip.bottom).toBeLessThanOrEqual(result.page.height);
});
