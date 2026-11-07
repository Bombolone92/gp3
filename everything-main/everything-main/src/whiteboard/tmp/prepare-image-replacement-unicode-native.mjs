import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '../tests/canvas.js';
import { board, item, validateBoard } from '../src/model.js';
const root='tmp/image-replacement-unicode-native';fs.mkdirSync(root,{recursive:true});
fs.cpSync('dist/assets',path.join(root,'assets'),{recursive:true});fs.cpSync('dist/icons',path.join(root,'icons'),{recursive:true});
const canvas=createCanvas(400,240),ctx=canvas.getContext('2d');
for(const[color,x,y]of [['#ff0000',0,0],['#00ff00',200,0],['#0000ff',0,120],['#ffff00',200,120]]){ctx.fillStyle=color;ctx.fillRect(x,y,200,120);}
const src=canvas.toDataURL(),b=board();b.title='Image replacement Unicode production verification';
b.items=[item('image',100,100,{w:200,h:120,text:'Target',src}),...[98,99,100].map((n,k)=>item('image',380+k*240,100,{w:200,h:120,text:'Q'.repeat(n)+'😀',src,lang:'fr-CA',textRuns:[{start:n,end:n+2,style:{lang:'en-GB'}}]}))];
const fixture=validateBoard(b);if(!fixture||fixture.items.length!==4)throw Error('invalid fixture');fs.writeFileSync('tmp/image-replacement-unicode-native-fixture.json',JSON.stringify(fixture));
let html=fs.readFileSync('tmp/search-unicode-final-native/index-final.html','utf8');
html=html.replace(/const fixture=.*?;\nawait new Promise/s,'const fixture='+JSON.stringify(fixture)+';\nawait new Promise');
html=html.slice(0,html.lastIndexOf('<script>'))+`<script>
let last='';function report(){const choices=[...document.querySelectorAll('[data-replacement-source]')].map((x,n)=>({n,valid:x.textContent.isWellFormed(),length:x.textContent.length,tail:x.textContent.slice(-5),lang:x.querySelector('[data-user-content]')?.lang,passage:x.querySelector('[lang="en-GB"]')?.textContent}));const originals=[...document.querySelectorAll('#board-outline [data-id]')].map(x=>({id:x.dataset.id,valid:x.textContent.isWellFormed(),emoji:x.textContent.includes('😀'),passage:x.querySelector('[lang="en-GB"]')?.textContent,lang:x.querySelector('[data-user-content]')?.lang}));const value={choices,originals,history:['undo','redo'].map(k=>document.querySelector('[data-action="'+k+'"]')?.disabled),language:document.documentElement.lang,focus:document.activeElement?.id};const next=JSON.stringify(value);if(next!==last){last=next;parent.postMessage(value,'*');}}new MutationObserver(()=>requestAnimationFrame(report)).observe(document.body,{childList:true,subtree:true,attributes:true});</script>`;
fs.writeFileSync(path.join(root,'index-before.html'),html);
const view=`<!doctype html><title>Image replacement Unicode before</title><style>body{margin:0;overflow:hidden}iframe{width:1200px;height:800px;border:0}pre{position:fixed;left:1210px;top:0;width:650px;max-height:850px;overflow:auto;white-space:pre-wrap;font:14px monospace}</style><iframe src="index-before.html#local=${fixture.id}"></iframe><pre></pre><script>addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow||!e.data.choices)return;const d=e.data;document.querySelector('pre').textContent=['UI '+d.language+'; undo/redo disabled='+d.history.join('/')+'; focus='+d.focus,...d.choices.map(x=>'r'+x.n+' valid='+x.valid+' len='+x.length+' '+x.lang+' passage='+(x.passage||'none')+' tail='+x.tail),...d.originals.map(x=>x.id+' valid='+x.valid+' emoji='+x.emoji+' '+x.lang+' passage='+(x.passage||'none'))].join('\\n');})</script>`;
fs.writeFileSync(path.join(root,'view-before.html'),view);console.log(JSON.stringify({id:fixture.id,objects:fixture.items.length,asset:html.match(/await import\('([^']+)'\)/)?.[1]}));
