import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/border-shared-origin/';
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const zoom of [100,200])test(`archived ${zoom}% whole crops expose regressions hidden by edge bounds`,async({page})=>{
 const archive=JSON.parse(readFileSync(folder+'coupled-pixels.json'));
 const ref=JSON.parse(readFileSync(folder+'reference.json'));
 expect(sha(folder+'reference.json')).toBe(archive.nativeReferenceSha256);
 expect(sha(folder+'rejected-fill-clip.js')).toBe(archive.clipSha256);
 await page.goto('/playground.html');
 const results=[];
 for(const source of ref.sources){
  const o=source.observations.find(o=>o.zoom===zoom),record=archive.observations.find(r=>r.owner===source.owner&&r.zoom===zoom);
  const images=[{mode:'native',png:readFileSync(folder+o.crop).toString('base64')}];
  for(const image of record.images){expect(sha(folder+image.file)).toBe(image.sha256);images.push({mode:image.mode,png:readFileSync(folder+image.file).toString('base64')});}
  const metrics=await page.evaluate(async({images,size,offset})=>{
   const masks={};
   for(const image of images){
    const im=new Image();im.src='data:image/png;base64,'+image.png;await im.decode();
    if(im.width!==size[0]||im.height!==size[1])throw Error('Unexpected crop size');
    const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    masks[image.mode]=Array.from({length:c.width*c.height},(_,i)=>Math.max(d[i*4],d[i*4+1],d[i*4+2])<128);
   }
   const out={};
   for(const mode of ['baseline','coupled','floor']){
    let differing=0;const worse=[];
    for(let i=0;i<masks.native.length;i++){
     differing+=masks.native[i]!==masks[mode][i];
     if(masks.native[i]===masks.baseline[i]&&masks.native[i]!==masks[mode][i])worse.push([i%size[0]+offset[0],Math.floor(i/size[0])+offset[1]]);
    }out[mode]={differing,worse};
   }return out;
  },{images,size:o.cropSize,offset:o.cropOffset});
  expect(metrics).toEqual(record.metrics);results.push(metrics);
 }
 expect(results[0]).toEqual(results[1]);
 expect(results[0].baseline.differing).toBe(zoom===100?627:954);
 expect(results[0].coupled).toEqual(zoom===100?{differing:159,worse:[[24,100],[64,100],[23,101]]}:{differing:0,worse:[]});
 expect(results[0].floor).toEqual({differing:0,worse:[]});
 // This exact connected crop is insufficient: eight other native edges regress.
 const evidence=JSON.parse(readFileSync('tests/fixtures/measurements/border-coupled-candidates.json'));
 expect(evidence.floor.regressions).toHaveLength(8);
});
