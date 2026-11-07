import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Diagnostic only: test byte rounding at intermediate HSL channel stages.
// Native reference hashes and label order are checked before scoring.
const root=new URL('../tests/fixtures/',import.meta.url);
const output=process.argv[2];
const names=['theme-low-chroma-sweep','theme-shade-sweep','theme-color-boundaries','theme-color-complements','theme-channel-extrema','theme-permutations'];
const sets=names.map(name=>{
 const read=n=>readFileSync(new URL(name+'/'+n,root)),cs=JSON.parse(read('cases.json')),ref=JSON.parse(read('reference.json'));
 for(const [file,key]of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256']])if(createHash('sha256').update(read(file)).digest('hex')!==ref[key])throw Error(name+' reference hash');
 return {name,cases:cs.map((c,i)=>{if(c.label!==ref.colors[i].label)throw Error('label');return {...c,rgb:[...Buffer.from(c.base,'hex')],expected:ref.colors[i].rgb};})};
});
function convert(c,opt){
 if(c.value===255)return c.rgb;
 const f=opt.float32?Math.fround:x=>x;
 const q=(x,method)=>method==='none'?x:f(Math[method](f(x*255))/255);
 const rgb=c.rgb.map(v=>f(v/255)),hi=Math.max(...rgb),lo=Math.min(...rgb),d=f(hi-lo);
 if(!d){const v=Math.floor((c.mode==='shade'?c.rgb[0]*c.value:65025-(255-c.rgb[0])*c.value)/255);return [v,v,v];}
 let l=f(f(hi+lo)/2),s=l<=.5?f(d/f(hi+lo)):f(d/f(f(2-hi)-lo));
 const amount=f(c.value/255);
 l=q(c.mode==='shade'?f(l*amount):f(f(l*amount)+f(1-amount)),opt.light);
 const high=q(l<=.5?f(l*f(1+s)):f(f(l+s)-f(l*s)),opt.high);
 const rawHigh=l<=.5?f(l*f(1+s)):f(f(l+s)-f(l*s));
 const low=q(f(f(2*l)-(opt.recompute?high:rawHigh)),opt.low);
 return rgb.map(v=>{
 const ratio=q(f(f(v-lo)/d),opt.ratio);
 return Math.max(0,Math.min(255,Math.floor(f(f(low+f(ratio*f(high-low)))*255))));
 });
}
const results=[];
for(const light of ['none','floor','round'])for(const high of ['none','floor','round'])for(const low of ['none','floor','round'])for(const ratio of ['none','floor','round'])for(const recompute of [false,true])for(const float32 of [false,true]){
 const opt={light,high,low,ratio,recompute,float32};
 const counts=sets.map(s=>({name:s.name,total:s.cases.length,match:s.cases.filter(c=>convert(c,opt).every((v,i)=>v===c.expected[i])).length}));
 results.push({...opt,match:counts.reduce((n,s)=>n+s.match,0),counts});
}
results.sort((a,b)=>b.match-a.match);
const winner=results[0];
const witnesses=sets.map(set=>{const c=set.cases.find(c=>!convert(c,winner).every((v,i)=>v===c.expected[i]));return c?{set:set.name,label:c.label,base:c.base,mode:c.mode,value:c.value,expected:c.expected,actual:convert(c,winner)}:null;}).filter(Boolean);
const out={scope:'Bounded diagnostic, not a complete search over color-conversion algorithms. No renderer change.',total:sets.reduce((n,s)=>n+s.cases.length,0),candidates:results.length,parameters:{light:['none','floor','round'],high:['none','floor','round'],low:['none','floor','round'],ratio:['none','floor','round'],recomputeLowFromRoundedHigh:[false,true],float32:[false,true]},fixedRules:'Byte scale 255; final channel floor; value 255 preserves the input; achromatic colors retain the existing exact integer rule. Initial HSL values are otherwise unquantized.',best:winner,witnesses};
if(output)writeFileSync(output,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
process.exitCode=Number(winner.match!==out.total);
