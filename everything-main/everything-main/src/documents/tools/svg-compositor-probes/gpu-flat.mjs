// Diagnostic candidate only; not imported by the application. Run from the repository root with Vite at 127.0.0.1:5173.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const path='tests/fixtures/svg-backdrop-compositing/',cases=JSON.parse(readFileSync(path+'cases.json')),ref=JSON.parse(readFileSync(path+'native-colors.json'));
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage();
try{await p.goto('http://127.0.0.1:5173/playground.html');const result=await p.evaluate(async cases=>{
 const {NativeSvgCompositor}=await import('/tools/svg-compositor-probes/gpu-float.js');const c=new NativeSvgCompositor(cases.length,1);const rgba=(color,alpha)=>[...color.match(/../g).map(s=>parseInt(s,16)),alpha];
 const lower=value=>{const f=new Float32Array(1),u=new Uint32Array(f.buffer);f[0]=value;if(f[0]>value)u[0]--;return f[0];};
 const bytes=new Uint8Array(cases.flatMap(v=>rgba(v.color,Math.floor(lower(v.opacity)*255)))),dest=new Uint8Array(cases.flatMap(v=>rgba(v.background,255)));c.compose(bytes,dest);const first=c.pixels();const second=new Uint8Array(cases.flatMap(v=>v.overlay?rgba(v.overlay.color,Math.floor(lower(v.overlay.opacity)*255)):[0,0,0,0]));c.compose(second,first);const out=c.pixels();c.close();return Array.from({length:cases.length},(_,i)=>[...out.slice(i*4,i*4+3)]);
},cases);const differences=result.flatMap((v,i)=>v.some((x,k)=>x!==ref.colors[i][k])?[{index:i,actual:v,native:ref.colors[i]}]:[]);writeFileSync('.private-svg-gpu-flat-result-20261004.json',JSON.stringify({result,differences},null,2));console.log(JSON.stringify({matched:36-differences.length,total:36,differences}));}finally{await b.close();}
