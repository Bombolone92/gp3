import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const root='tests/fixtures/merged-side-borders/';
const ref=JSON.parse(readFileSync(root+'reference.json'));
let dom,pkg;
beforeAll(async()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;pkg=await DocxPackage.open(readFileSync(root+'controls.docx'));});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('matches independently recorded native reference borders on each physical merged row',()=>{
 for(const [file,key] of [['controls.docx','sourceSha256'],['native.pdf','pdfSha256']])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(ref[key]);
 const layout=layoutDocument(pkg.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:0}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 for(const [i,table] of pkg.tables.entries()){
  const cell=layout.cells.find(c=>c.tableId===table.id),x=cell.x+cell.width;
  for(const [ri,sample] of ref.cases[i].samples.entries()){
   const y=cell.y+cell.height*(ri+.5)/3;
   const stroke=layout.tableBorders.find(b=>b.tableId===table.id&&!b.guide&&!b.horizontal&&Math.abs(b.x+b.width/2-x)<.01&&y>b.y&&y<b.y+b.height);
   expect(!!stroke,ref.cases[i].name+' row '+ri).toBe(sample.ink);
   if(stroke){const rgb=stroke.border.color.match(/../g).map(c=>parseInt(c,16));for(let k=0;k<3;k++)expect(Math.abs(rgb[k]-sample.rgb[k])).toBeLessThanOrEqual(1);}
  }
 }
});
it('keeps a uniform outer merged dashed edge continuous across physical rows',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'controls.docx')),table=p.tables[0];
 const removed=new Set(table.rows.map(row=>row.cells[1].id));
 p.paragraphs=p.paragraphs.filter(paragraph=>!removed.has(paragraph.cellId));
 table.grid=table.grid.slice(0,1);for(const row of table.rows)row.cells=row.cells.slice(0,1);
 const border={...table.rows[0].cells[0].borders.right,style:'dashed'};
 for(const row of table.rows)row.cells[0].borders={...row.cells[0].borders,right:{...border}};
 const layout=layoutDocument(p.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:0}),pageGeometry(p.pageSettings),p.numbering,p.tables);
 const cell=layout.cells.find(c=>c.tableId===table.id),x=cell.x+cell.width;
 const strokes=layout.tableBorders.filter(b=>b.tableId===table.id&&!b.guide&&!b.horizontal&&Math.abs(b.x+b.width/2-x)<.01);
 expect(strokes).toHaveLength(1);expect(strokes[0].border.style).toBe('dashed');expect(strokes[0].height).toBeCloseTo(cell.height,6);
});
