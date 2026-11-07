// Rendering diagnostic only. Does not modify the editor or assert native reference fidelity.
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
const rows=await page.evaluate(()=>{
 const results=[];
 for(const scale of [1,2,4])for(const pen of [.14,.34071,1])for(const method of ['ellipse','cubic','polygon','fill-offset']){
  const a=100*scale,b=45*scale,w=pen*scale,c=new OffscreenCanvas(220*scale,110*scale),ctx=c.getContext('2d');
  ctx.translate(110*scale,55*scale);ctx.lineWidth=w;ctx.strokeStyle=ctx.fillStyle='#c0c0c0';ctx.lineJoin='round';ctx.beginPath();
  if(method==='ellipse')ctx.ellipse(0,0,a,b,0,0,Math.PI*2);
  if(method==='cubic'){const k=.5522847498307936;ctx.moveTo(a,0);ctx.bezierCurveTo(a,k*b,k*a,b,0,b);ctx.bezierCurveTo(-k*a,b,-a,k*b,-a,0);ctx.bezierCurveTo(-a,-k*b,-k*a,-b,0,-b);ctx.bezierCurveTo(k*a,-b,a,-k*b,a,0);ctx.closePath();}
  if(method==='polygon'||method==='fill-offset'){
   const N=2048;
   for(const side of method==='polygon'?[0]:[1,-1]){
    for(let i=0;i<=N;i++){const t=(side===-1?N-i:i)*2*Math.PI/N,cos=Math.cos(t),sin=Math.sin(t),normal=Math.hypot(cos/a,sin/b),x=a*cos+side*w/2*cos/a/normal,y=b*sin+side*w/2*sin/b/normal;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();
   }
  }
  if(method==='fill-offset')ctx.fill();else ctx.stroke();
  const d=ctx.getImageData(0,0,c.width,c.height).data;let alpha=0;for(let i=3;i<d.length;i+=4)alpha+=d[i]/255;
  let perimeter=0;for(let i=0;i<16384;i++){const t=(i+.5)*Math.PI*2/16384;perimeter+=Math.hypot(a*Math.sin(t),b*Math.cos(t))*Math.PI*2/16384;}
  results.push({scale,pen,method,coverageRatio:alpha/(perimeter*w)});
 }return results;
});console.log(JSON.stringify({browserVersion:browser.version(),purpose:'Compare direct stroke and offset-region fill coverage; not a production stroker',rows},null,2));await browser.close();
