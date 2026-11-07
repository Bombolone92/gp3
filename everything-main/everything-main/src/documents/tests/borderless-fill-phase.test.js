import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {deviceTableFillRects} from '../src/engine/border-device-layout.js';
const folder='tests/fixtures/borderless-fill-phase/';
const cases=JSON.parse(readFileSync(folder+'cases.json')),reference=JSON.parse(readFileSync(folder+'reference.json'));
const context=(scale,e=0,f=0)=>({getTransform:()=>({a:scale,b:0,c:0,d:scale,e,f})});
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('pins the original source, cases and independently captured reference crops',()=>{
 const hash=name=>createHash('sha256').update(readFileSync(folder+name)).digest('hex');
 expect(hash('control.docx')).toBe(reference.sourceSha256);expect(hash('cases.json')).toBe(reference.casesSha256);
 for(const o of reference.observations)expect(hash(o.crop)).toBe(o.cropSha256);
});
for(const o of reference.observations)it(`projects all 75 original cells to independent ${o.zoom}% reference bounds`,()=>{
 const cells=cases.flatMap(c=>c.widthsTwips.map((w,col)=>{
  const offset=c.widthsTwips.slice(0,col).reduce((a,b)=>a+b,0)/15;
  return{id:`${c.id}:${col}`,fill:'#'+c.colors[col],x:c.xTwips/15+offset,y:c.yTwips/15,width:w/15,height:c.heightTwips/15,tableOffsetX:offset};
 }));const before=JSON.stringify(cells),scale=o.zoom/100;
 const fills=deviceTableFillRects(context(scale),cells,[],[]);
 expect(o.rows.map(r=>{const b=fills.get(`${r.id}:${r.column}`);return[b.x,b.y,b.x+b.width,b.y+b.height].map(v=>Math.round(v*scale));})).toEqual(o.rows.map(r=>r.bounds));
 expect(JSON.stringify(cells)).toBe(before);
});
it('preserves each table grid offset through floating positioning and pagination',async()=>{
 const pkg=await DocxPackage.open(readFileSync(folder+'control.docx'));
 const layout=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize,ascent:style.fontSize,descent:0}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 expect(layout.cells).toHaveLength(75);
 const expected=cases.flatMap(c=>c.widthsTwips.map((w,col)=>({x:(c.xTwips+c.widthsTwips.slice(0,col).reduce((a,b)=>a+b,0))/15,offset:c.widthsTwips.slice(0,col).reduce((a,b)=>a+b,0)/15})));
 for(const [i,c] of layout.cells.entries()){expect(c.x).toBeCloseTo(expected[i].x,6);expect(c.tableOffsetX).toBeCloseTo(expected[i].offset,6);}
});
it('uses cumulative grid edges when preceding cells are unfilled or absent, including translated contexts',()=>{
 for(const scale of [.75,1,1.25,1.5,1.75,2]){
  const cells=[0,1,2].map(i=>({id:String(i),fill:'#FF0000',x:24.6+i*293/15,tableOffsetX:i*293/15,y:24.6,width:293/15,height:8}));
  const ctx=context(scale,3.2,4.7),all=deviceTableFillRects(ctx,cells,[],[]),last=deviceTableFillRects(ctx,[cells[2]],[],[]).get('2');
  expect(last).toEqual(all.get('2'));
  expect(all.get('0').x+all.get('0').width).toBeCloseTo(all.get('1').x,10);
  expect(all.get('1').x+all.get('1').width).toBeCloseTo(last.x,10);
 }
});
it('retains parent clips and explicit shading reserves after device projection',()=>{
 const c={id:'a',fill:'#FF0000',x:24.6,y:24.6,width:40,height:16,tableOffsetX:20,borderInsets:{top:2,bottom:1},fillTopInset:3,fillBottomInset:2,cellClip:{left:27,right:60,top:29,bottom:35}};
 const before=JSON.stringify(c),r=deviceTableFillRects(context(2),[c],[],[]).get('a');
 expect(r.x).toBeGreaterThanOrEqual(27);expect(r.x+r.width).toBeLessThanOrEqual(60);expect(r.y).toBeGreaterThanOrEqual(29);expect(r.y+r.height).toBeLessThanOrEqual(35);
 expect(JSON.stringify(c)).toBe(before);
});
it('keeps shared row edges continuous from the full frame even when its first row is unfilled',()=>{
 for(const scale of [.75,1,1.25,1.5,1.75,2,4]){
  const cells=[0,1,2,3].map(i=>({id:String(i),tableId:'t',page:0,x:24.6,y:24.6+i*127/15,width:40,height:127/15,fill:i?'#FF0000':null}));
  const fills=deviceTableFillRects(context(scale),cells,[],[]);
  expect(fills.has('0')).toBe(false);
  expect(fills.get('1').y+fills.get('1').height).toBeCloseTo(fills.get('2').y,10);
  expect(fills.get('2').y+fills.get('2').height).toBeCloseTo(fills.get('3').y,10);
 }
});
