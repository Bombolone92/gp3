import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const measure=text=>({width:text.length*8,ascent:15,descent:5});
async function lines(name){const p=await DocxPackage.open(readFileSync(`public/fixtures/${name}.docx`));return layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables).lines;}
const baseline=(lines,page,text)=>lines.find(l=>l.page===page&&l.fragments.map(f=>f.text).join('')===text).baseline;
it('does not add the preceding bottom border to a row without a top declaration',async()=>{
 const ls=await lines('row-border-insets');
 for(const page of [1,2,3,4,5])expect(baseline(ls,page,'Body')).toBeCloseTo(baseline(ls,0,'Body'));
 expect(baseline(ls,2,'Last')-baseline(ls,0,'Last')).toBeCloseTo(2*4/3);
});
it('uses its own top width even when the opposing bottom border wins, including nil',async()=>{
 const ls=await lines('row-border-opposition');
 for(let group=0;group<2;group++)for(const [index,points] of [0,.5,1,2,3,0].entries()){
  expect(baseline(ls,group*6+index,'Body')-baseline(ls,0,'Body')).toBeCloseTo(points*4/3);
  expect(baseline(ls,group*6+index,'Header')).toBeCloseTo(baseline(ls,0,'Header'));
 }
});
