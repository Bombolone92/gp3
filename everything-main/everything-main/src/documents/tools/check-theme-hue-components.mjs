import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Diagnostic only. The selected hypotheses remain rejected until every native
// reference matches; this file is never imported by the document renderer.
const root=new URL('../tests/fixtures/',import.meta.url);
const names=['theme-low-chroma-sweep','theme-shade-sweep','theme-color-boundaries','theme-color-complements','theme-channel-extrema','theme-permutations'];
const sets=names.map(name=>{
 const read=n=>readFileSync(new URL(name+'/'+n,root)),cases=JSON.parse(read('cases.json')),reference=JSON.parse(read('reference.json'));
 for(const[file,key]of[['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256']])if(createHash('sha256').update(read(file)).digest('hex')!==reference[key])throw Error(name+' hash');
 return {name,cases:cases.map((c,i)=>{if(c.label!==reference.colors[i].label)throw Error('label');return {...c,rgb:[...Buffer.from(c.base,'hex')],expected:reference.colors[i].rgb};})};
});
const quant=(v,mode)=>mode==='none'?v:Math[mode](v);
const options=[{scale:1,mode:'none'},...[240,255,256,360,1530,1536,65535,65536].flatMap(scale=>['floor','round'].map(mode=>({scale,mode})))];
function convert(c,hq,sq,lq,component,after){
 if(c.value===255)return c.rgb;
 const hi=Math.max(...c.rgb),lo=Math.min(...c.rgb),d=hi-lo;
 if(!d){const v=Math.floor((c.mode==='shade'?c.rgb[0]*c.value:65025-(255-c.rgb[0])*c.value)/255);return[v,v,v];}
 // Quantize differences separately before subtracting the two hue components.
 const hueDifference=v=>quant((hi-v)*hq.scale/(6*d),hq.mode)/hq.scale;
 const delta=c.rgb.map(hueDifference);
 let h=hi===c.rgb[0]?delta[2]-delta[1]:hi===c.rgb[1]?1/3+delta[0]-delta[2]:2/3+delta[1]-delta[0];
 if(!component){const ratio=hi===c.rgb[0]?(c.rgb[1]-c.rgb[2])/d:hi===c.rgb[1]?2+(c.rgb[2]-c.rgb[0])/d:4+(c.rgb[0]-c.rgb[1])/d;h=quant(ratio*hq.scale/6,hq.mode)/hq.scale;}
 h=(h+1)%1;
 const s=quant(d*sq.scale/(hi+lo<=255?hi+lo:510-hi-lo),sq.mode)/sq.scale;
 const light=quant((hi+lo)*lq.scale/510,lq.mode)/lq.scale;
 const raw=c.mode==='shade'?light*c.value/255:light*c.value/255+1-c.value/255;
 const l=after?quant(raw*after.scale,after.mode)/after.scale:raw;
 const high=l<=.5?l*(1+s):l+s-l*s,low=2*l-high;
 const channel=h=>{h=(h+1)%1;return h<1/6?low+(high-low)*6*h:h<.5?high:h<2/3?low+(high-low)*(2/3-h)*6:low;};
 return [h+1/3,h,h-1/3].map(h=>Math.max(0,Math.min(255,Math.floor(channel(h)*255+1e-9))));
}
const rows=sets.flatMap(s=>s.cases),results=[];
const afterOptions=[{scale:1,mode:'none'},...[240,255,256,510,512,1000,65535,65536,100000].flatMap(scale=>['floor','round'].map(mode=>({scale,mode})))];
for(const hq of options.filter(o=>[1,240,255,256,360].includes(o.scale)))for(const sq of options.filter(o=>[1,240,255,256].includes(o.scale)))for(const lq of [{scale:1,mode:'none'}])for(const component of [true,false])for(const after of afterOptions){
 const matches=rows.filter(c=>convert(c,hq,sq,lq,component,after).every((v,i)=>v===c.expected[i])).length;
 results.push({hq,sq,lq,component,after,matches});
}
results.sort((a,b)=>b.matches-a.matches);
const best=results[0];
const report={hypothesis:'Hue-component quantization combined with transformed-lightness quantization; includes half-byte grids and DrawingML percentage scale.',cases:rows.length,candidates:results.length,best:results.slice(0,12),witnesses:sets.flatMap(set=>{const c=set.cases.find(c=>convert(c,best.hq,best.sq,best.lq,best.component,best.after).some((v,i)=>v!==c.expected[i]));return c?[{set:set.name,case:c,actual:convert(c,best.hq,best.sq,best.lq,best.component,best.after)}]:[];})};
report.scope='Bounded hypothesis test, not a search over all color-conversion algorithms or a rendering pass.';
report.parameters={hue:options.filter(o=>[1,240,255,256,360].includes(o.scale)),saturation:options.filter(o=>[1,240,255,256].includes(o.scale)),initialLightness:'unquantized',hueComponents:[true,false],transformedLightness:afterOptions};
report.fixedRules='Modifier divided by 255; final channel floor with 1e-9 numerical guard; identity at modifier 255; existing exact achromatic rule; channels clamped to byte range.';
report.counts=sets.map(s=>({name:s.name,total:s.cases.length,matched:s.cases.filter(c=>convert(c,best.hq,best.sq,best.lq,best.component,best.after).every((v,i)=>v===c.expected[i])).length}));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
process.exitCode=Number(best.matches!==rows.length);
