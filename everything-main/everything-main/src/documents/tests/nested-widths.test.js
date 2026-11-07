import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const ref=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-width-reference.json','utf8'));
for(const mode of ['width-half','width-full','width-half-15','width-full-15'])it(`uses the containing cell for nested percentage widths, matching the native reference: ${mode}`,async()=>{
 const bytes=readFileSync(`tests/fixtures/nested-tables/nested-clipping-${mode}.docx`);expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref[mode].sourceSha256);
 const p=await DocxPackage.open(bytes),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),original=JSON.stringify(d.tables);
 const layout=layoutDocument(d.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize,descent:style.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
 const child=d.tables.find(t=>t.parentCellId),width=layout.tableWidths[child.id].reduce((a,b)=>a+b,0)*.75;
 // The native reference colored bounds include the two half-point exterior border halves.
 expect(Math.abs(width+1-(ref[mode].colors.inner.right-ref[mode].colors.inner.left))).toBeLessThan(.65);
 expect(width).toBeCloseTo(mode.startsWith('width-half')?116.5:233,10);expect(JSON.stringify(d.tables)).toBe(original);
 d.select(d.text.indexOf('Inner line 1'));d.fitTable('page');expect(d.tableContext.table.width).toEqual({type:'pct',value:5000});
 const exported=new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()),again=await DocxPackage.open(exported);expect(again.tables.find(t=>t.parentCellId).width).toEqual({type:'pct',value:5000});
});
