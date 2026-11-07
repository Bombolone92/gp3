import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom=new JSDOM(); globalThis.DOMParser=dom.window.DOMParser; globalThis.XMLSerializer=dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

for(const name of ['near','full','single','repeated','terminal','large','spaced','keep','spaced-suppressed','spaced-after','spaced-repeated']) it(`retains the native reference column-boundary flow through edits: ${name}`,async()=>{
 const folder='tests/fixtures/column-break-boundaries/';
 const ref=JSON.parse(readFileSync(folder+name+'-reference.json')),pkg=await DocxPackage.open(readFileSync(folder+name+'.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const render=()=>layoutDocument(doc.paragraphs,(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize*1.06,descent:style.fontSize*.27}),pageGeometry(doc.pageSettings),doc.numbering,doc.tables);
 const layout=render(),visible=layout.lines.filter(line=>line.fragments.some(f=>f.text.trim()));
 expect(layout.pageCount).toBe(ref.pages);expect(visible).toHaveLength(ref.lines.length);
 ref.lines.forEach((expected,i)=>{
  const line=visible[i];expect(line.page).toBe(expected.page);
  expect(Math.abs(line.stops[0].x*.75-expected.x)).toBeLessThan(.15);
  expect(hitTest(layout,line.page,line.stops[0].x+.1,line.y+line.height/2)).toBe(line.start);
 });
 if(name.startsWith('spaced') || name==='terminal')expect(visible.at(-1).y).toBeCloseTo(48+(ref.lines.at(-1).baseline-45.62)*4/3,5);
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(pkg.parts);
 doc.select(doc.text.indexOf('After'));doc.replace('Edited ');expect(render().pageCount).toBe(ref.pages);
 const edited=await save(),parts=unzipSync(edited),reopened=await DocxPackage.open(edited);
 expect(new TextDocument(reopened.paragraphs).text).toBe(doc.text);
 for(const key of Object.keys(pkg.parts))if(key!=='word/document.xml')expect(parts[key],key).toEqual(pkg.parts[key]);
 doc.undo();expect(unzipSync(await save())).toEqual(pkg.parts);
});
