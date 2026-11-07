import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Image } from '@napi-rs/canvas';
import { createCanvas } from '../tests/canvas.js';
import { board,item,validateBoard } from '../src/model.js';
import { exportRegions } from '../src/export.js';
import { exportPPTX as original } from '../src/export-pptx.js';
import { exportPPTX as candidate } from './pptx-language-candidate.js';
import { readZip } from '../src/unzip.js';
globalThis.window={Image,devicePixelRatio:1};
globalThis.document={documentElement:{},createElement:()=>{
 const c=createCanvas(1,1); c.getBoundingClientRect=()=>({width:c.width,height:c.height}); return c;
}};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});
const b=board('Language preservation');
const frame=item('frame',0,0,{w:640,h:400,text:'Hello bonjour',lang:'en-CA',textRuns:[{start:6,end:13,style:{lang:'fr-CA'}}]});
b.items=[frame,item('note',20,70,{text:'Bonjour hello\nMerci',lang:'fr-CA',textRuns:[{start:8,end:13,style:{lang:'en-GB'}}],parentId:frame.id}),item('table',260,70,{w:300,h:180,cells:[['Bonjour','hello'],['Merci','thanks']],lang:'fr',cellLanguages:{'0,1':{lang:'en-GB'},'1,1':{lang:'en-CA'}},parentId:frame.id})];
validateBoard(b);
const out=[];
for(const [name,fn] of [['before',original],['candidate',candidate]]){
 const snapshot=structuredClone(b);
 const data=await (await fn(snapshot,exportRegions(snapshot,{scope:'frames'}),{lang:'en'})).arrayBuffer();
 await writeFile(`tmp/pptx-raster-${name}.pptx`,new Uint8Array(data));
 out.push(readZip(data));
}
const [a,c]=out;
const changes=[];
for(const name of a.names){
 const before=await a.bytes(name),after=await c.bytes(name);
 if(!Buffer.from(before).equals(Buffer.from(after)))changes.push(name);
}
assert.deepEqual(changes,['ppt/slides/slide1.xml','ppt/notesSlides/notesSlide1.xml']);
console.log('All media, package structure, relationships and other parts remain byte-identical. Only title/note XML changes.');
