import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {paragraphText} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const cases=['row-merged-later-14',...['oversized','later'].flatMap(position=>[14,15].map(mode=>`row-merged-exact-${position}-${mode}`))];
for(const name of cases)it(`matches the native reference physical rows, merged source flow and visible editing bounds: ${name}`,async()=>{
 const pkg=await DocxPackage.open(readFileSync(`public/fixtures/row-geometry/${name}-probe.docx`));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=JSON.parse(readFileSync(`tests/fixtures/row-geometry/${name}-native-lines.json`,'utf8'));
 expect(result.pageCount).toBe(expected.length);
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 const lines=[...result.lines,...result.repeatedLines];
 const tokens=text=>text.match(/Left \d{3}|Right first|Right second|Header|Trailing|After table|Merged minimum/g)||[];
 for(const page of expected){
  const first=tokens(page.lines[0].text)[0];
  const anchor=lines.find(l=>l.page===page.page-1&&labels.get(l.paragraphId)===first);
  expect(anchor,`${name} page ${page.page} anchor`).toBeDefined();
  for(const reference of page.lines)for(const label of tokens(reference.text)){
   const line=lines.find(l=>l.page===page.page-1&&labels.get(l.paragraphId)===label);
   expect(line,`${label} on page ${page.page}`).toBeDefined();
   expect(Math.abs((line.baseline-anchor.baseline)*.75-(page.lines[0].y-reference.y)),label).toBeLessThan(.25);
  }
 }
 const last=result.lines.find(l=>labels.get(l.paragraphId)==='Left 084');
 expect(last.page,'all source survives on its allocated page').toBe(name==='row-merged-exact-oversized-15'?3:1);
 for(const line of result.lines){
  const caret=caretRect(result,line.start);
  expect(caret.y+caret.height,`${labels.get(line.paragraphId)} caret`).toBeLessThanOrEqual(result.page.height+1e-6);
 }
});
