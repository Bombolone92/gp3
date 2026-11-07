import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,hitTest,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/nested-table-overlap/',source=readFileSync(root+'control.docx'),refs=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const render=d=>layoutDocument(d.paragraphs,t=>({width:t.length*5,ascent:12,descent:4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const geometry=l=>l.floatingTables.map(({page,left,right,top,bottom})=>({page,left,right,top,bottom}));
it('binds the native reference to the exact source and native reference PDF',()=>{
 for(const [name,hash]of Object.entries(refs.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
});
it('places competing nested floats against the native reference across overlap flags, distances, borders and three-table cases',async()=>{
 const l=render(model(await DocxPackage.open(source)));expect(l.pageCount).toBe(22);
 for(const [i,expected]of refs.pages.entries())for(const ref of expected){const line=l.lines.find(l=>l.page===i&&l.fragments.map(f=>f.text).join('')===ref.text);expect(line,`case ${i+1} ${ref.text}`).toBeTruthy();expect(Math.abs(line.stops[0].x*.75-ref.x),`case ${i+1} ${ref.text} X`).toBeLessThan(.15);expect(Math.abs(line.baseline*.75-ref.y),`case ${i+1} ${ref.text} Y`).toBeLessThan(.15);}
});
it('reflows collisions after editing a child and preserves hit testing, exports, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=render(d),original=unzipSync(source);
 const exact=bytes=>{const parts=unzipSync(bytes);expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());for(const[n,b]of Object.entries(original))expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);};exact(await save(p,d));
 const first=before.lines.find(l=>l.fragments.map(f=>f.text).join('')==='A5');d.select(first.start);d.replace('Extra\n');const after=render(d);
 expect(after.floatingTables.filter(f=>f.page===4)[1].top-before.floatingTables.filter(f=>f.page===4)[1].top).toBeCloseTo(20);
 const second=after.lines.find(l=>l.fragments.map(f=>f.text).join('')==='B5'),caret=caretRect(after,second.start);expect(hitTest(after,caret.page,caret.x+.1,caret.y+caret.height/2)).toBe(second.start);
 const bytes=await save(p,d),parts=unzipSync(bytes);expectBodyEditParts(parts,original);
 expect(geometry(render(model(await DocxPackage.open(bytes))))).toEqual(geometry(after));d.undo();exact(await save(p,d));expect(geometry(render(d))).toEqual(geometry(before));
},60000);
