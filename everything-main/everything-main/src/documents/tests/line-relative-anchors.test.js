import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument,imageAtPoint} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {breakAfter} from '../src/engine/intrinsic-widths.js';

let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('resolves manual-line anchors from their own line and preserves the paragraph control',async()=>{
 const p=await DocxPackage.open(readFileSync('tests/fixtures/line-relative-anchors/control.docx'));
 const ref=JSON.parse(readFileSync('tests/fixtures/line-relative-anchors/reference.json'));
 const layout=layoutDocument(p.paragraphs,(t,s)=>({width:t.length*s.fontSize*.5,ascent:10,descent:3}),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
 expect(layout.pageCount).toBe(8);expect(layout.floatingObjects).toHaveLength(8);
 for(const f of layout.floatingObjects){
  // Automatic wrapping depends on real Arial metrics and is checked in-browser.
  if(f.page!==2)[f.x,f.y,f.width,f.height].forEach((v,j)=>expect(v*.75).toBeCloseTo(ref.bounds[f.page][j],2));
  expect(imageAtPoint(layout,f.page,f.x+10,f.y+10)?.image.id).toBe(f.image.id);
 }
});

it('does not turn floating anchors inside a word into break opportunities',()=>{
 expect(breakAfter('\ufffc',{anchor:{wrap:'none',vertical:'line'}})).toBe(false);
 expect(breakAfter('\ufffc',{anchor:{wrap:'none',vertical:'paragraph'}})).toBe(false);
 expect(breakAfter('\ufffc',{width:914400,height:914400})).toBe(true);
 expect(breakAfter(' ')).toBe(true);
 expect(breakAfter('\u00a0')).toBe(false);
});
