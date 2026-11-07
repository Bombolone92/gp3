import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {emfInfo} from '../src/engine/emf-images.js';
for(const [variant,limits] of [['a',[1,8,1,1]],['b',[1,1,1,10]]]){
 const parts=unzipSync(readFileSync(`tests/fixtures/emf-miter-effects-${variant}/control.docx`));
 it.each(limits.map((limit,row)=>({limit,row})))(`miter ${variant} row $row keeps native interpretation with and without pixel effects`,({limit,row})=>{
  for(const index of [row*2,row*2+1])for(const pixelEffects of [false,true]){
   expect(emfInfo(parts[`word/media/edge${index}.emf`],{pixelEffects}).svg).toContain(`stroke-miterlimit="${limit}"`);
  }
 });
}
