import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const root='tests/fixtures/merged-rounding-minimum/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const native=JSON.parse(readFileSync(root+'native-widths.json','utf8').replace(/^\uFEFF/,''));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('binds native reference logical-width measurements to independently authored merged-cell controls',()=>{
  for(const [name,hash] of Object.entries(native.hashes))
    expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
  expect(native.widthsBeforePdf).toHaveLength(cases.length);
  cases.forEach((c,i)=>{
    const nativeWidth=native.widthsBeforePdf[i].slice(c.spanStart,c.spanStart+c.spanCount).reduce((a,b)=>a+b,0)*20;
    expect(nativeWidth).toBeGreaterThanOrEqual(c.imageWidthTwips+2-1e-4);
  });
});

it('keeps every unbreakable merged picture and its margins inside the rounded grid',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'control.docx'));
  const layout=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*.3,ascent:style.fontSize,descent:style.fontSize/3}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  expect(pkg.tables).toHaveLength(cases.length);
  pkg.tables.forEach((table,i)=>{
    const widths=table.rows[0].cells.map(c=>layout.cells.find(p=>p.id===c.id).width*15);
    const merged=layout.cells.find(p=>p.id===table.rows[1].cells[cases[i].spanStart].id);
    expect(widths.reduce((a,b)=>a+b,0)).toBeCloseTo(1000,6);
    expect(merged.width*15).toBeGreaterThanOrEqual(cases[i].imageWidthTwips+2-1e-6);
  });
});
