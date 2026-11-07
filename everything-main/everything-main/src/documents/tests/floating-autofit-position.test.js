import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const root='tests/fixtures/floating-autofit-position/',source=readFileSync(root+'control.docx'),refs={pages:JSON.parse(readFileSync(root+'origins.json')),sha256:JSON.parse(readFileSync(root+'manifest.json')).sha256};
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const render=d=>layoutDocument(d.paragraphs,t=>({width:t.length*5,ascent:12,descent:4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
it('binds the native reference to the exact source and native reference PDF',()=>{
 for(const [name,hash]of Object.entries(refs.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
});
it('retains preferred AutoFit columns at increasing floating offsets',async()=>{
 const l=render(model(await DocxPackage.open(source)));expect(l.pageCount).toBe(6);
 for(const [i,expected]of refs.pages.entries())for(const ref of expected){const line=l.lines.find(l=>l.page===i&&l.fragments.map(f=>f.text).join('')===ref.text);expect(line,`case ${i+1} ${ref.text}`).toBeTruthy();expect(Math.abs(line.stops[0].x*.75-ref.x),`case ${i+1} ${ref.text} X`).toBeLessThan(.15);expect(Math.abs(line.baseline*.75-ref.y),`case ${i+1} ${ref.text} Y`).toBeLessThan(.15);}
});
