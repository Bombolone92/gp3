import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createCanvas} from '../tests/canvas.js';
import {board,item,validateBoard} from '../src/model.js';
import {exportPPTX} from '../src/export-pptx.js';
import {exportRegions} from '../src/export.js';
import {readZip} from '../src/unzip.js';
let seed=13;const rand=n=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n;
const tags=['fr','en-GB','de','es'];
const pieces=['A','é','😀','&',' ','\t','\r\n','\r','\n'];
for(let sample=0;sample<200;sample++){
 let text='',textRuns=[],units=[];
 for(let n=0;n<40;n++){
  const piece=pieces[rand(pieces.length)],start=text.length,lang=tags[rand(tags.length)];
  text+=piece;textRuns.push({start,end:text.length,style:{lang}});
  for(const char of piece) units.push({char,lang});
 }
 const b=board('Oracle');b.items=[item('note',0,0,{text,lang:'fr',textRuns})];validateBoard(b);
 const expected=[];let line=[];
 for(let n=0;n<units.length;n++){
  const {char,lang}=units[n];
  if(char==='\r'||char==='\n'){
   expected.push(line);line=[];
   if(char==='\r'&&units[n+1]?.char==='\n')n++;
  }else if(char==='\t')for(const char of ' | ')line.push({char,lang});
  else line.push({char,lang});
 }
 expected.push(line);
 const wanted=expected.map(line=>{
  while(line.length&&/\s/u.test(line[0].char))line.shift();
  while(line.length&&/\s/u.test(line.at(-1).char))line.pop();
  return line;
 }).filter(line=>line.length);
 const zip=readZip(await(await exportPPTX(b,exportRegions(b),{rasterizer:async()=>createCanvas(1,1)})).arrayBuffer());
 const doc=new JSDOM(await zip.text('ppt/notesSlides/notesSlide1.xml'),{contentType:'application/xml'}).window.document;
 const actual=[...doc.getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','r')].flatMap(r=>{
  const lang=r.getElementsByTagNameNS('*','rPr')[0].getAttribute('lang');
  return Array.from(r.getElementsByTagNameNS('*','t')[0].textContent,char=>({char,lang}));
 })).filter(line=>line.length);
 assert.deepEqual(actual,wanted,`sample ${sample}`);
}
console.log('200 generated mixed-language notes match the independent character-by-character whitespace oracle');
