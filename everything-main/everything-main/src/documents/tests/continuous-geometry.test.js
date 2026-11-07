import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(()=>dom.window.close());
const reference=JSON.parse(readFileSync('tests/fixtures/continuous-geometry/reference.json','utf8'));
it.each(Object.keys(reference))('matches the native reference page breaks and section origins for continuous %s changes',async name=>{
 const pkg=await DocxPackage.open(readFileSync(`tests/fixtures/continuous-geometry/${name}.docx`));
 const placed=layoutDocument(pkg.paragraphs,(t,s)=>({width:t.length*s.fontSize*.6,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=reference[name].pages;
 expect(placed.pageCount).toBe(expected.length);
 expected.forEach((page,index)=>{
  expect(placed.pages[index].width*.75).toBe(page.width);expect(placed.pages[index].height*.75).toBe(page.height);
  const rows=placed.lines.filter(l=>l.page===index&&!l.virtual);
  expect(rows.map(l=>l.fragments.map(f=>f.text||'').join(''))).toEqual(page.runs.map(r=>r.text));
  rows.forEach((line,i)=>{
   expect(Math.abs(line.stops[0].x*.75-page.runs[i].x)).toBeLessThan(.15);
   expect(Math.abs(line.baseline*.75-page.runs[i].baseline)).toBeLessThan(.2);
  });
 });
});
