import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {markerGeometry} from '../src/engine/list-layout.js';
import {LineBuilder} from '../src/engine/line-builder.js';
import {runFormat} from '../src/engine/model.js';
const root='tests/fixtures/list-suffix-boundary/',ref=JSON.parse(readFileSync(root+'reference.json'));
const measure=t=>({width:t.length*5,ascent:10,descent:3}),style=runFormat({fontSize:10});
it('binds independent sources and reference exports to the reference',()=>{for(const[n,h]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+n)).digest('hex')).toBe(h);});
it('accepts an exact body-indent suffix boundary independently of page origin and compatibility flag',()=>{
 for(const left of [0,120,240])for(const indent of [0,288,720])for(const noTabHangInd of [false,true]){
  const format={tabs:[],indentLeft:indent,firstLine:0},page={left,defaultTabStop:720,noTabHangInd,allowOverflowIndents:true};const start=left+indent/15;
  const marker={text:'I.',level:{alignment:'right',suffix:'tab',markerStyle:{}}};expect(markerGeometry(marker,style,start,left+600,format,page,measure,0).left).toBeCloseTo(start);
  const ordinary=new LineBuilder(start,left+600,format,page,measure,0);ordinary.add({text:'\t',start:0,end:1,style});expect(ordinary.end).toBeGreaterThan(start);
 }
});
it('still advances suffix tabs when the label ends beyond the body indent',()=>{
 const format={tabs:[],indentLeft:288,firstLine:0},page={left:120,defaultTabStop:720};
 for(const alignment of ['left','center'])expect(markerGeometry({text:'I.',level:{alignment,suffix:'tab',markerStyle:{}}},style,139.2,600,format,page,measure,0).left).toBe(168);
});
