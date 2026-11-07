import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {paragraphText} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for(const mode of [14,15])it(`matches the native reference when the declared row fits a page but not its header in mode ${mode}`,async()=>{
 const pkg=await DocxPackage.open(readFileSync(`public/fixtures/row-geometry/row-header-threshold-${mode}-probe.docx`));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=JSON.parse(readFileSync(`tests/fixtures/row-geometry/row-header-threshold-${mode}-native-lines.json`,'utf8'));
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 expect(result.pageCount).toBe(expected.length);
 for(const page of expected){
  const actual=[...result.lines,...result.repeatedLines].filter(l=>l.page===page.page-1&&labels.get(l.paragraphId)).sort((a,b)=>a.y-b.y||a.x-b.x);
  expect(actual.map(l=>labels.get(l.paragraphId)),`page ${page.page}`).toEqual(page.lines.map(l=>l.text));
  actual.forEach((line,index)=>expect(Math.abs((line.baseline-actual[0].baseline)*.75-(page.lines[0].y-page.lines[index].y)),labels.get(line.paragraphId)).toBeLessThan(.25));
 }
});
