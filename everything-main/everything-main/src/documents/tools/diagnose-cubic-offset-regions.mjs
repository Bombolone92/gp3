import {chromium} from '@playwright/test';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
if(process.argv.length!==3)throw new Error('Usage: node tools/diagnose-cubic-offset-regions.mjs NEW_OUTPUT.json');
const output=resolve(process.argv[2]);
if(existsSync(output))throw new Error('Refusing to overwrite diagnostic evidence');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(()=>{
  const k=4*(Math.SQRT2-1)/3,rows=[];
  function evaluate(c,t,r){
   const u=1-t,p=[0,1].map(i=>u*u*u*c[0][i]+3*u*u*t*c[1][i]+3*u*t*t*c[2][i]+t*t*t*c[3][i]);
   const d=[0,1].map(i=>3*u*u*(c[1][i]-c[0][i])+6*u*t*(c[2][i]-c[1][i])+3*t*t*(c[3][i]-c[2][i]));
   const dd=[0,1].map(i=>6*u*(c[2][i]-2*c[1][i]+c[0][i])+6*t*(c[3][i]-2*c[2][i]+c[1][i]));
   const l=Math.hypot(...d),n=[d[1]/l,-d[0]/l],h=(d[0]*dd[0]+d[1]*dd[1])/(l*l);
   const nd=[dd[1]/l-n[0]*h,-dd[0]/l-n[1]*h];
   return {p:p.map((x,i)=>x+r*n[i]),d:d.map((x,i)=>x+r*nd[i])};
  }
  const center=(a,b)=>[[[a,0],[a,k*b],[k*a,b],[0,b]],[[0,b],[-k*a,b],[-a,k*b],[-a,0]],[[-a,0],[-a,-k*b],[-k*a,-b],[0,-b]],[[0,-b],[k*a,-b],[a,-k*b],[a,0]]];
  function fit(c,start,end,r,output,depth=0){
   const a=evaluate(c,start,r),b=evaluate(c,end,r),dt=(end-start)/3;
   const curve=[a.p,a.p.map((v,i)=>v+dt*a.d[i]),b.p.map((v,i)=>v-dt*b.d[i]),b.p];
   let error=0;
   for(const t of [.125,.25,.375,.5,.625,.75,.875]){
    const p=evaluate(curve,t,0).p,q=evaluate(c,start+(end-start)*t,r).p;
    error=Math.max(error,Math.hypot(p[0]-q[0],p[1]-q[1]));
   }
   if(error>.002&&depth<12){const mid=(start+end)/2;fit(c,start,mid,r,output,depth+1);fit(c,mid,end,r,output,depth+1);}
   else output.push({curve,start,end,center:c,r});
  }
  function region(a,b,pen){
   const path=new Path2D(),fitted=[];
   for(const r of [pen/2,-pen/2]){
    const segments=[];for(const c of center(a,b))fit(c,0,1,r,segments);
    fitted.push(...segments);
    if(r<0)segments.reverse();
    segments.forEach((s,i)=>{const c=r<0?[...s.curve].reverse():s.curve;
     if(!i)path.moveTo(...c[0]);path.bezierCurveTo(...c[1],...c[2],...c[3]);});path.closePath();
   }
   return {path,fitted};
  }
  for(const [a,b] of [[100,45],[45,100],[120,12],[12,120],[100,100]])for(const pen of [.14,.34071,.5,1]){
   const {path,fitted}=region(a,b,pen);let maxError=0;
   for(const s of fitted)for(let i=0;i<=256;i++){
    const t=i/256,p=evaluate(s.curve,t,0).p,q=evaluate(s.center,s.start+(s.end-s.start)*t,s.r).p;
    maxError=Math.max(maxError,Math.hypot(p[0]-q[0],p[1]-q[1]));
   }
   const canvas=new OffscreenCanvas(Math.ceil(2*a+10),Math.ceil(2*b+10)),ctx=canvas.getContext('2d');ctx.translate(a+5,b+5);
   ctx.fill(path);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   let alpha=0,length=0;for(let i=3;i<data.length;i+=4)alpha+=data[i]/255;
   for(const c of center(a,b))for(let i=0;i<4096;i++)length+=Math.hypot(...evaluate(c,(i+.5)/4096,0).d)/4096;
   rows.push({axes:[a,b],pen,segments:fitted.length,maxSampledError:maxError,areaRatio:alpha/(length*pen)});
  }
  const timing=[];
  for(let repeat=0;repeat<5;repeat++){
   const began=performance.now();let segments=0;
   for(let i=0;i<474;i++)segments+=region(100,45,.34071).fitted.length;
   timing.push({ms:performance.now()-began,segments});
  }
  return {scope:'Closed cubic ellipse offset geometry only; sampled error is not a rigorous bound; no native pixel, general join/cap/self-intersection or production timing certification',rows,timing};
 });
 const toolSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
 writeFileSync(output,JSON.stringify({...result,browserVersion:browser.version(),toolSha256},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({rows:result.rows.length,maxSampledError:Math.max(...result.rows.map(r=>r.maxSampledError)),minAreaRatio:Math.min(...result.rows.map(r=>r.areaRatio)),maxAreaRatio:Math.max(...result.rows.map(r=>r.areaRatio)),timing:result.timing}));
}finally{await browser.close();}
