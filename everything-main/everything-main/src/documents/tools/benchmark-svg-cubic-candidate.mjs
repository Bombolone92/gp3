// Explicit opt-in benchmark: production SVG rendering never imports the candidate.
import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
const [output,extraSvg]=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/benchmark-svg-cubic-candidate.mjs output.json [private.svg]');
const root=fileURLToPath(new URL('../',import.meta.url));
const baseline=readFileSync(resolve(root,'src/engine/svg-native-strokes.js'),'utf8');
const hook='if (rasterGroups && correctViewport) nativeSvgGroups(svg);';
if(!baseline.includes(hook))throw Error('Renderer hook changed; review benchmark before running');
const modified=`import {nativeSvgMaskedCubics} from '/tools/candidates/svg-cubic-coverage-benchmark.mjs';\n`+baseline.replace(hook,'if (rasterGroups && correctViewport) { nativeSvgMaskedCubics(svg); nativeSvgGroups(svg); }');
const candidate=readFileSync(resolve(root,'tools/candidates/svg-cubic-coverage.mjs'),'utf8');
const sources=['svg-cubic-coverage','svg-cubic-coverage-large'].map(name=>({name,source:new TextDecoder().decode(unzipSync(readFileSync(resolve(root,`tests/fixtures/${name}/control.docx`)))['word/media/vector.svg'])}));
if(extraSvg)sources.push({name:basename(extraSvg),source:readFileSync(extraSvg,'utf8')});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
try{
  const page=await browser.newPage();
  await page.route('**/src/engine/svg-native-strokes-candidate.js',route=>route.fulfill({contentType:'text/javascript',body:modified}));
  await page.route('**/tools/candidates/svg-cubic-coverage-benchmark.mjs',route=>route.fulfill({contentType:'text/javascript',body:candidate}));
  await page.goto((process.env.REVIEW_URL||'http://127.0.0.1:5173')+'/playground.html');
  const rows=await page.evaluate(async sources=>{
    const baseline=(await import('/src/engine/svg-native-strokes.js')).nativeSvgStrokes;
    const candidate=(await import('/src/engine/svg-native-strokes-candidate.js')).nativeSvgStrokes;
    const rows=[];
    for(const {name,source} of sources){
      const root=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
      const dimensions={width:Number(root.getAttribute('width')),height:Number(root.getAttribute('height'))};
      for(let repeat=0;repeat<18;repeat++)for(const variant of repeat%2?['candidate','baseline']:['baseline','candidate']){
        const started=performance.now(),preview=({baseline,candidate})[variant](root,dimensions,true),prepared=performance.now();
        const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(preview)],{type:'image/svg+xml'}));
        try{
          const image=new Image();image.src=url;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;
          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,300,200);ctx.getImageData(0,0,1,1);
          if(repeat>2)rows.push({name,variant,prepare:prepared-started,total:performance.now()-started});
        }finally{URL.revokeObjectURL(url);}
      }
    }
    return rows;
  },sources);
  writeFileSync(output,JSON.stringify({mode:'raster',rows},null,2)+'\n');
  for(const {name} of sources)for(const variant of ['baseline','candidate']){
    const selected=rows.filter(row=>row.name===name&&row.variant===variant);
    const median=metric=>selected.map(row=>row[metric]).sort((a,b)=>a-b)[Math.floor(selected.length/2)];
    console.log(name,variant,{prepare:median('prepare'),total:median('total')});
  }
}finally{await browser.close();}
