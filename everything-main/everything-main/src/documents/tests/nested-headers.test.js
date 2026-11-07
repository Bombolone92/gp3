import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const reference=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-header-reference.json','utf8'));
for(const [mode,expected] of Object.entries(reference))it(`matches the native reference nested header repetitions without discarding source flags: ${mode}`,async()=>{
 const bytes=readFileSync(`tests/fixtures/nested-tables/nested-clipping-${mode}.docx`);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected.sourceSha256);
 const pkg=await DocxPackage.open(bytes),before=JSON.stringify(pkg.tables);
 const layout=layoutDocument(pkg.paragraphs,(text,style)=>({width:[...text].length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 expect(layout.pageCount).toBe(expected.pageCount);
 for(const [text,pages] of Object.entries(expected.labels)) expect([...layout.lines,...layout.repeatedLines].filter(l=>labels.get(l.paragraphId)===text).map(l=>l.page).sort(),text).toEqual(pages);
 const byLabel=new Map([...layout.lines,...layout.repeatedLines].map(l=>[`${l.page}:${labels.get(l.paragraphId)}`,l]));
 const first=expected.geometry[0],offset=byLabel.get(`${first.page}:${first.text}`).baseline*.75-first.baseline;
 for(const line of expected.geometry) {
   const actual=byLabel.get(`${line.page}:${line.text}`);expect(actual,line.text).toBeDefined();
   expect(Math.abs(actual.baseline*.75-line.baseline-offset),line.text).toBeLessThan(.25);
 }
 expect(JSON.stringify(pkg.tables)).toBe(before);
 if(mode==='header-container')for(const cell of layout.cells.filter(c=>c.depth===2&&c.page===1)) {
   expect(cell.cellClip.top).toBeGreaterThanOrEqual(layout.page.top);
   const hidden=[...layout.lines,...layout.repeatedLines].find(l=>l.page===1&&labels.get(l.paragraphId)==='Inner line 3');
   expect(hidden.cellClip.bottom).toBeLessThanOrEqual(hidden.y);
 }
 const model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 model.select(model.text.length);model.replace(' edited');
 const output=new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer());
 const reopened=await DocxPackage.open(output);
 expect(reopened.tables.map(t=>t.rows.map(r=>!!r.header))).toEqual(pkg.tables.map(t=>t.rows.map(r=>!!r.header)));
 model.undo();const restored=new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer());
 expect(unzipSync(restored)).toEqual(unzipSync(bytes));
});
