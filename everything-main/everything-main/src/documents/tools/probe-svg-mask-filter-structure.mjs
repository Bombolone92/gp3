// Diagnostic counterexamples for the rejected mask-content filter wrapper.
// Run from src/documents. These compare browser semantics, not the native reference.
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/playground.html');
 const rows=await page.evaluate(async()=>{
  const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
  const results=[];
  for(const [name,style,attributes,content] of [
   ['direct-child','mask > rect {fill:white}', 'maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"','<rect width="120" height="80"/>'],
   ['first-child','mask > rect:first-child {fill:white}', 'maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"','<rect width="120" height="80"/>'],
   ['stroked-zero-height','', 'maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"','<line x1="10" y1="40" x2="110" y2="40" stroke="white" stroke-width="20"/>'],
   ['wrapper-selector','mask > g {display:none!important}', 'maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"','<rect width="120" height="80" fill="white"/>'],
   ['new-child-selector','mask > g > rect {fill:black!important}', 'maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"','<rect width="120" height="80" fill="white"/>'],
   ['wide-blur','', 'maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"','<defs><filter id="blur" x="-1000%" y="-1000%" width="2100%" height="2100%"><feGaussianBlur stdDeviation="10"/></filter></defs><rect x="58" y="38" width="4" height="4" fill="white" filter="url(#blur)"/>'],
   ['normalized-content','', 'maskContentUnits="objectBoundingBox"','<rect width="1" height="1" fill="white"/>'],
   ['shifted-content','', 'maskUnits="userSpaceOnUse" x="200" y="0" width="120" height="80"','<rect x="200" width="120" height="80" fill="white"/>'],
  ]) for(const mode of ['baseline','matrix']) {
   const shifted=name==='shifted-content';
   const root=new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="${shifted?200:0} 0 120 80"><style>${style}</style><defs><mask id="m" ${attributes}>${content}</mask></defs><rect x="${shifted?200:0}" width="120" height="80" fill="red" mask="url(#m)"/></svg>`,'image/svg+xml').documentElement;
   const output=nativeSvgStrokes(root,{width:120,height:80},true);
   if(mode==='matrix'){
    const ns='http://www.w3.org/2000/svg', make=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
    const filter=make('filter',{id:'coeff',filterUnits:'userSpaceOnUse',x:-1,y:-1,width:122,height:82,'color-interpolation-filters':'sRGB'});
    filter.append(make('feColorMatrix',{type:'matrix',values:'.2125 .7154 .0721 0 0 .2125 .7154 .0721 0 0 .2125 .7154 .0721 0 0 0 0 0 1 0'}));
    const mask=output.querySelector('mask'),group=make('g',{filter:'url(#coeff)'});while(mask.firstChild)group.append(mask.firstChild);mask.append(group);output.append(filter);mask.style.maskType='luminance';mask.style.colorInterpolation='sRGB';
   }
   const im=new Image();im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(output));await im.decode();
   const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;const ctx=canvas.getContext('2d');ctx.drawImage(im,0,0);
   const pixels=ctx.getImageData(0,0,120,80).data;let alphaSum=0;for(let i=3;i<pixels.length;i+=4)alphaSum+=pixels[i];
   const rgbaSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].map(b=>b.toString(16).padStart(2,'0')).join('');
   results.push({name,mode,alphaSum,centerAlpha:pixels[(40*120+60)*4+3],rgbaSha256});
  }
  return results;
 });
 const report={scope:'Browser baseline/candidate semantics; not a native reference oracle',browserVersion:browser.version(),rows};
 if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
