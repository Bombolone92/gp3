import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {chartSegments,chartScale,paintChart} from '../src/engine/canvas-charts.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const refs=['stacked-charts','chart-colors','chart-metadata'].flatMap(folder=>JSON.parse(readFileSync(`tests/fixtures/${folder}/reference.json`,'utf8')));
const source=name=>readFileSync(`${name==='chart-metadata-order'?'tests/fixtures/chart-metadata':'public/fixtures'}/${name}.docx`);
const data=p=>Object.values(p.assets).find(a=>a.chart).chart;
it.each(refs)('matches the native reference stack geometry, colors and axis ticks for $name',async r=>{
 const pkg=await DocxPackage.open(source(r.name)),chart=data(pkg),rects=[],outlines=[],labels=[];
 const ctx={fontKerning:'none',save(){},restore(){},scale(){},measureText:t=>({width:t.length*6}),fillRect(x,y,w,h){rects.push({color:this.fillStyle.toLowerCase(),x,y,w,h});},strokeRect(x,y,w,h){outlines.push({color:this.strokeStyle,x,y,w,h});},fillText(t){labels.push(t);},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
 paintChart(ctx,chart,576,384);
 const plot=outlines.find(b=>b.color==='#b3b3b3'&&b.w>200&&b.h>100);
 const bars=rects.map(b=>({...b,x:(b.x-plot.x)/plot.w,y:(b.y-plot.y)/plot.h,w:b.w/plot.w,h:b.h/plot.h}));
 expect(bars).toHaveLength(r.bars.length);
 const used=new Set();
 for(const b of bars){const match=r.bars.findIndex((v,i)=>!used.has(i)&&v.color===b.color&&['x','y','w','h'].every(k=>Math.abs(v[k]-b[k])<.001));expect(match,JSON.stringify(b)).toBeGreaterThanOrEqual(0);used.add(match);}
 expect(labels.filter(t=>/^-?\d+%?$/.test(t))).toEqual(r.ticks);
 expect(outlines.filter(b=>b.color!=='#b3b3b3').map(b=>b.color).sort()).toEqual(r.outlines.map(b=>b.color).sort());
});
it('normalizes each category by absolute values and accumulates signs independently',()=>{
 const series=[{values:[2,-2,0]},{values:[-3,4,0]},{values:[5,-4,0]}];
 expect(chartSegments(series,'percentStacked')).toEqual([
  [{start:0,end:.2},{start:0,end:-.2},{start:0,end:0}],
  [{start:0,end:-.3},{start:0,end:.4},{start:0,end:0}],
  [{start:.2,end:.7},{start:-.2,end:-.6000000000000001},{start:0,end:0}],
 ]);
 expect(chartScale(series,'percentStacked').min).toBeCloseTo(-.6);
 expect(chartScale(series,'percentStacked').max).toBe(.8);
 expect(chartScale(series,'percentStacked').step).toBe(.2);
 expect(chartScale([{values:[0,0]}],'percentStacked')).toEqual({min:0,max:1,step:.1});
});
it('round trips edits, deletion and undo without changing chart caches, styles or unrelated parts',async()=>{
 const bytes=source('percent-mixed-color'),pkg=await DocxPackage.open(bytes),parts=unzipSync(bytes);
 const d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const unchanged=actual=>{expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))expect(Buffer.from(actual[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
 unchanged(unzipSync(await save()));d.select(0);d.replace('EDIT ');
 let edited=await save();const changed=unzipSync(edited);
 expectBodyEditParts(changed,parts);
 expect(data(await DocxPackage.open(edited))).toEqual(data(pkg));d.undo();unchanged(unzipSync(await save()));
 const at=d.text.indexOf('\ufffc');d.select(at,at+1);d.replace('');expect(d.text).not.toContain('\ufffc');d.undo();unchanged(unzipSync(await save()));
});
it.each([
 ['overlap range',x=>x.replace('overlap val="100"','overlap val="101"')],
 ['fractional overlap',x=>x.replace('overlap val="100"','overlap val="0.5"')],
 ['unsupported format',x=>x.replace('formatCode="0%"','formatCode="0.00E+00"')],
 ['invalid inversion',x=>x.replace('invertIfNegative val="0"','invertIfNegative val="yes"')],
])('rejects %s without making an editable package',async(_,mutate)=>{
 const parts=unzipSync(source('percent-mixed-color'));parts['word/charts/chart1.xml']=strToU8(mutate(strFromU8(parts['word/charts/chart1.xml'])));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
