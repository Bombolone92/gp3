import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const folder='tests/fixtures/continuous-boundary/';
const cases=JSON.parse(readFileSync(folder+'cases.json'));
const setup=async name=>{const pkg=await DocxPackage.open(readFileSync(folder+name+'.docx'));return {pkg,model:new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets)};};
const layout=model=>layoutDocument(model.paragraphs,(t,s)=>({width:t.length*s.fontSize*.7,ascent:s.fontSize*1.1,descent:s.fontSize*.3}),pageGeometry(model.pageSettings),model.numbering,model.tables);
const after=l=>l.lines.find(l=>l.fragments.some(f=>f.text==='AFTER'));
it('retains only required continuous boundary lines without changing the source model',async()=>{
 for(const c of cases){
  const {model}=await setup(c.name),before=structuredClone(model.paragraphs),l=layout(model);
  expect(model.paragraphs).toEqual(before);
  const boundary=l.lines.filter(l=>l.emptySectionBoundary).at(-1),kept=c.kind==='continuous'&&(c.emptySection||c.table&&(c.compatibility??15)>=15);
  expect(boundary.virtual,c.name).toBe(!kept);
  const caret=caretRect(l,boundary.start);expect(caret.height).toBeGreaterThan(0);
  expect(l.pageCount,c.name).toBe(c.kind==='nextPage'?2:1);
 }
});
it('preserves height differences after tables and in empty sections, including two-column balancing',async()=>{
 for(const c of cases.filter(c=>c.height===12&&!c.decoration&&!c.spaceBefore)){
  const other=cases.find(x=>x.name===c.name.replace(/12$/,'24'));if(!other)continue;
  const first=layout((await setup(c.name)).model),second=layout((await setup(other.name)).model);
  expect((after(second).baseline-after(first).baseline)*.75,c.name).toBeCloseTo(c.emptySection||c.table&&(c.compatibility??15)>=15?12:0,5);
 }
});
it('retains required paragraph shading and spacing while suppressing an empty boundary border',async()=>{
 const decorated=layout((await setup('table-decoration')).model);
 expect(decorated.lines.some(l=>l.paragraphBackground)).toBe(true);expect(decorated.paragraphBorders).toHaveLength(0);
 const plain=after(layout((await setup('table-1-1-continuous-12')).model));
 const spaced=after(layout((await setup('table-spacing')).model));expect((spaced.baseline-plain.baseline)*.75).toBeCloseTo(24,5);
});
it('round-trips boundary edits and restores every source package part after undo',async()=>{
 const {pkg,model}=await setup('table-2-1-continuous-24'),before=layout(model);
 const boundary=before.lines.find(l=>l.continuousBoundaryLine);model.select(boundary.start);model.replace('Typed boundary');
 const save=async()=>new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles,model.tables,model.assets).arrayBuffer());
 const output=await save(),reopened=await DocxPackage.open(output);expect(reopened.paragraphs.some(p=>p.runs.some(r=>r.text==='Typed boundary'))).toBe(true);
 const parts=unzipSync(output);for(const name of Object.keys(pkg.parts))if(name!=='word/document.xml')expect(parts[name]).toEqual(pkg.parts[name]);
 model.undo();expect(unzipSync(await save())).toEqual(pkg.parts);
});
