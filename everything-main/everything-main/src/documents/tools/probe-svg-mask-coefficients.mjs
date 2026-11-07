// Diagnostic only: fixed-size authored controls, alpha-channel comparisons.
// Filter bounds are only exercised in controls with matching mask coordinates.
// Neither filter candidate is production-safe; see the fixture README.
import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync,writeFileSync} from 'node:fs';
const root='./', results=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage(); await page.goto('http://127.0.0.1:5173/playground.html');
 for(const name of ['svg-mask-opacity','svg-mask-opacity-expanded','svg-mask-opaque','svg-mask-luminance-coefficients','svg-mask-quantization','svg-mask-quantization-boundary','svg-mask-composition','svg-mask-nested','svg-image-masks','svg-image-masks-scaled','svg-image-masks-step','svg-mask-edges']) {
  const source=unzipSync(readFileSync(root+'public/fixtures/'+name+'.docx'))['word/media/vector.svg'];
  const refs=JSON.parse(readFileSync(root+'tests/fixtures/'+name+'/metafile-reference.json')).images.map(ref=>({...ref,url:'data:image/png;base64,'+readFileSync(root+'tests/fixtures/'+name+'/'+ref.path).toString('base64')}));
  for(const mode of ['baseline','matrix']) {
   const rows=await page.evaluate(async({source,refs,mode,bounded,singleMatrix})=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const original=new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(source)),'image/svg+xml').documentElement;
    const output=nativeSvgStrokes(original,{width:120,height:80},true); output.style.transform='none';
    if(mode==='matrix') {
     const ns='http://www.w3.org/2000/svg'; const make=(n,a)=>{const el=document.createElementNS(ns,n);for(const[k,v]of Object.entries(a))el.setAttribute(k,v);return el;};
     for(const[i,mask]of [...output.querySelectorAll('mask')].entries()){
      const units=mask.getAttribute('maskUnits')||'objectBoundingBox',contentUnits=mask.getAttribute('maskContentUnits')||'userSpaceOnUse';
      if(bounded && (units!==contentUnits || ['x','y','width','height'].some(k=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(mask.getAttribute(k)||''))))throw Error('Probe requires matching coordinates and explicit numeric mask bounds');
      const bounds=bounded?Object.fromEntries(['x','y','width','height'].map(k=>[k,mask.getAttribute(k)])):{x:-1,y:-1,width:122,height:82};
      const id='coeff-'+i; const filter=make('filter',{id,filterUnits:'userSpaceOnUse',...bounds,'color-interpolation-filters':'sRGB'});
      const values=singleMatrix?'.2125 .7154 .0721 0 0 .2125 .7154 .0721 0 0 .2125 .7154 .0721 0 0 0 0 0 1 0':'0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .2125 .7154 .0721 0 0';
      filter.append(make('feColorMatrix',{in:'SourceGraphic',type:'matrix',values,result:'luma'}));
      if(!singleMatrix)filter.append(make('feComposite',{in:'luma',in2:'SourceAlpha',operator:'in'}));
      const group=make('g',{filter:'url(#'+id+')'}); while(mask.firstChild)group.append(mask.firstChild); mask.append(group);output.append(filter);mask.style.maskType=singleMatrix?'luminance':'alpha';
      if(singleMatrix)mask.style.colorInterpolation='sRGB';
     }
    }
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(output));await image.decode();
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const rows=[];
    for(const[i,ref]of refs.entries()){
     const im=new Image();im.src=ref.url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const n=c.getContext('2d');n.drawImage(im,0,0);
     const native=n.getImageData(0,0,c.width,c.height).data,actual=ctx.getImageData(ref.transform[4],ref.transform[5],c.width,c.height).data;
     let differences=0,total=0,max=0;for(let at=3;at<native.length;at+=4){const delta=Math.abs(actual[at]-native[at]);if(delta)differences++;total+=delta;max=Math.max(max,delta);}
     const center=(Math.floor(c.height/2)*c.width+Math.floor(c.width/2))*4+3;
     const rgbaSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',actual))].map(b=>b.toString(16).padStart(2,'0')).join('');
     rows.push({case:i,differences,total,max,rgbaSha256,center:{native:native[center],actual:actual[center]}});
    }return rows;
   },{source:[...source],refs,mode,bounded:process.argv.includes('--mask-bounds'),singleMatrix:process.argv.includes('--single-matrix')});
   results.push({name,mode,rows});
  }
 }
 const output=process.argv.slice(2).find(arg=>!arg.startsWith('--')); if(output)writeFileSync(output,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}finally{await browser.close();}
