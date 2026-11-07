// Diagnostic only. Interleaved whole-operation costs; no renderer mutation.
import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'msedge'}), results=[];
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/playground.html');
 for(const name of ['svg-mask-luminance-coefficients','svg-mask-quantization','svg-image-masks-scaled']){
  const source=unzipSync(readFileSync('public/fixtures/'+name+'.docx'))['word/media/vector.svg'];
  results.push({name,...await page.evaluate(async({source,bounded})=>{
   const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
   const xml=new TextDecoder().decode(new Uint8Array(source));
   const samples={baseline:[],matrix:[]}, phases={baseline:[],matrix:[]};
   async function run(mode){
    const start=performance.now();
    const original=new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;
    const output=nativeSvgStrokes(original,{width:120,height:80},true);
    if(mode==='matrix'){
     const ns='http://www.w3.org/2000/svg';const make=(name,a)=>{const n=document.createElementNS(ns,name);for(const[k,v]of Object.entries(a))n.setAttribute(k,v);return n;};
     for(const[i,mask]of [...output.querySelectorAll('mask')].entries()){
      const id='coeff-'+i,filter=make('filter',{id,filterUnits:'userSpaceOnUse',...(bounded?{x:mask.getAttribute('x'),y:mask.getAttribute('y'),width:mask.getAttribute('width'),height:mask.getAttribute('height')}:{x:-1,y:-1,width:122,height:82}),'color-interpolation-filters':'sRGB'});
      filter.append(make('feColorMatrix',{in:'SourceGraphic',type:'matrix',values:'0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .2125 .7154 .0721 0 0',result:'luma'}));
      filter.append(make('feComposite',{in:'luma',in2:'SourceAlpha',operator:'in'}));
      const group=make('g',{filter:'url(#'+id+')'});while(mask.firstChild)group.append(mask.firstChild);mask.append(group);output.append(filter);mask.style.maskType='alpha';
     }
    }
    const prepared=performance.now();
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(output)],{type:'image/svg+xml'}));
    const image=new Image(),canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
    try{image.src=url;await image.decode();const c=canvas.getContext('2d');c.drawImage(image,0,0);c.getImageData(0,0,120,80);const end=performance.now();return {total:end-start,prepare:prepared-start,decodePaint:end-prepared};}
    finally{image.removeAttribute('src');URL.revokeObjectURL(url);canvas.width=canvas.height=0;}
   }
   for(let i=0;i<33;i++)for(const mode of i%2?['matrix','baseline']:['baseline','matrix']){const r=await run(mode);if(i>=3){samples[mode].push(r.total);phases[mode].push(r);}}
   const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
   return {samples,medians:Object.fromEntries(Object.entries(phases).map(([mode,rows])=>[mode,Object.fromEntries(['total','prepare','decodePaint'].map(k=>[k,median(rows.map(r=>r[k]))]))]))};
  },{source:[...source],bounded:process.argv.includes('--mask-bounds')})});
 }
 const output=process.argv.slice(2).find(arg=>!arg.startsWith('--')); if(output)writeFileSync(output,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.map(({name,medians})=>({name,medians}))));
}finally{await browser.close();}
