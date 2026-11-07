import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {canvasLinearGradient} from '../src/engine/drawing-gradients.js';
const folder='tests/fixtures/gradient-colors';
const cases=JSON.parse(readFileSync(`${folder}/cases.json`));
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));
function paint(stops){
 const calls=[],gradient={addColorStop:(position,color)=>calls.push({position,color})};
 canvasLinearGradient({createLinearGradient:()=>gradient},{angle:0,scaled:false,stops},210,65);
 return calls;
}
for(const [i,colors] of cases.entries()){
 if(reference.functions[i].type!==0)continue;
 it(`matches native two-stop colors ${colors.join(' to ')}`,()=>{
  const stops=colors.map((color,i)=>({position:i,color:'#'+color})),before=structuredClone(stops);
  const actual=paint(stops);expect(actual).toHaveLength(256);expect(stops).toEqual(before);
  // Native PDF's dark channels quantize a few samples immediately next to
  // black to zero. Compare the curve interior separately from those steps.
  for(let k=4;k<252;k++){
   const rgb=actual[k].color.match(/[\d.]+/g).map(Number);
   for(let c=0;c<3;c++)expect(Math.abs(Math.round(rgb[c])-reference.functions[i].colors[k][c]),`sample ${k} channel ${c}`).toBeLessThanOrEqual(2);
  }
  for(const k of [0,255]){
   const rgb=actual[k].color.match(/[\d.]+/g).map(Number);
   rgb.forEach((v,c)=>expect(v).toBeCloseTo(reference.functions[i].colors[k][c],8));
  }
 });
}
it.each([
 [{position:.25,color:'#FF0000'},{position:.75,color:'#0000FF'}],
 [{position:0,color:'#FF0000'},{position:.5,color:'#00FF00'},{position:1,color:'#0000FF'}],
 [{position:0,color:'rgba(255,0,0,0.5)'},{position:1,color:'#0000FF'}],
].map(stops=>[stops]))('retains piecewise linear interpolation for non-simple gradients %j',stops=>{
 const last=stops.at(-1);
 expect(paint(stops)).toEqual([...stops,...(last.position<1?[{position:1,color:last.color}]:[])]);
});
it('extends the final original color after resolving a positive interior tie',()=>{
 expect(paint([{position:.5,color:'#FF1571'},{position:.5,color:'#FDC082'}])).toEqual([
  {position:.5,color:'#FF1571'},{position:1,color:'#FDC082'},
 ]);
});
