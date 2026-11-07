import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';

const root='tests/fixtures/nowrap-edge-allowance/';
const native=JSON.parse(readFileSync(root+'native-widths.json','utf8').replace(/^\uFEFF/,''));
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

it('binds the logical native reference observations to the original two-column controls',()=>{
  for(const [name,hash] of Object.entries(native.hashes))
    expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
  expect(cases).toHaveLength(24);
  expect(native.widthsBeforePdf).toHaveLength(cases.length);
});

it('matches all native protected-edge widths',async()=>{
  const pkg=await DocxPackage.open(readFileSync(root+'control.docx'));
  // The only text in these cells is a dot, safely below every explicit
  // preference. The automatic cell contains an exact 40-twip inline picture.
  const layout=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*.3,ascent:style.fontSize,descent:style.fontSize/3}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  expect(pkg.tables).toHaveLength(cases.length);
  pkg.tables.forEach((table,i)=>{
    table.rows[0].cells.forEach((cell,column)=>{
      const placed=layout.cells.find(c=>c.id===cell.id);
      const expected=Math.round(native.widthsBeforePdf[i][column]*20);
      expect(Math.abs(placed.width*15-expected),`case ${i+1}, column ${column+1}`).toBeLessThanOrEqual(.000001);
    });
  });
});
