// Diagnostic only: compare a rejected floor-only candidate against native references.
// Report regressions among previously correct colors; do not install this transform.
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
import {themeColorTransform} from '../src/engine/colors.js';
for(const set of ['theme-color-precision','theme-color-boundaries','theme-shade-sweep']){
 const cases=JSON.parse(fs.readFileSync(new URL('tests/fixtures/'+set+'/cases.json',root)));const r=JSON.parse(fs.readFileSync(new URL('tests/fixtures/'+set+'/'+(set==='theme-color-precision'?'native-saved-colors.json':'reference.json'),root)));let count=0, regressions=0, improved=0;
 for(const[i,c]of cases.entries()){const channels=c.base.match(/../g).map(v=>parseInt(v,16)/255),hi=Math.max(...channels),lo=Math.min(...channels),d=hi-lo,l=(hi+lo)/2,s=d===0?0:d/(1-Math.abs(2*l-1)),next=c.mode==='tint'?l*c.value/255+1-c.value/255:l*c.value/255,ch=(1-Math.abs(2*next-1))*s,min=next-ch/2;const actual=channels.map(v=>Math.floor(255*(d?min+(v-lo)/d*ch:next)+1e-9).toString(16).padStart(2,'0')).join('').toUpperCase();const expected=set==='theme-color-precision'?r[i].attributes.val:r.colors[i].rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();const old=themeColorTransform(c.base,c.mode==='tint'?c.value/255:undefined,c.mode==='shade'?c.value/255:undefined);if(actual===expected){count++;if(old!==expected)improved++;}if(old===expected&&actual!==expected)regressions++;}
 console.log(set,{matches:count,total:cases.length,regressions,improved});
}
