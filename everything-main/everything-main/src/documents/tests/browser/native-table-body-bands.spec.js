import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const folder='tests/fixtures/border-axis-phase/';
const ref=JSON.parse(readFileSync(folder+'screen-body-bands.json'));
for(const zoom of [100,200])test(`all 512 native ${zoom}% straight-body bands reproduce independently of corner bounds`,async({page})=>{
  test.setTimeout(180000);await page.goto('/playground.html',{timeout:180000});
  const placement=JSON.parse(readFileSync(folder+(zoom===100?'screen-reference.json':'screen-reference-200.json')));
  for(const observation of ref.observations.filter(o=>o.zoom===zoom)){
    const result=await page.evaluate(async({bytes,observation,offset})=>{
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const surface=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=surface.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return observation.bands.map(b=>{
        const [x,y,w,h]=b.region,data=ctx.getImageData(x-offset[0],y-offset[1],w,h).data;
        if(x<offset[0]||y<offset[1]||x-offset[0]+w>surface.width||y-offset[1]+h>surface.height)throw new Error('Native sample exceeds its crop');
        const across=b.axis==='h'?h:w,along=8,ink=[];
        for(let at=0;at<across;at++){
          const channels=[[],[],[]];
          for(let n=0;n<along;n++){
            const index=(b.axis==='h'?at*w+n:n*w+at)*4;
            for(let c=0;c<3;c++)channels[c].push(data[index+c]);
          }
          const medians=channels.map(v=>{v.sort((a,z)=>a-z);return Math.trunc((v[3]+v[4])/2);});
          ink.push(Math.max(...medians)<128);
        }
        const runs=[];let start=null;const base=b.axis==='h'?y:x;
        [...ink,false].forEach((active,i)=>{
          if(active&&start===null)start=i;
          if(!active&&start!==null){runs.push([base+start,base+i]);start=null;}
        });return runs;
      });
    },{bytes:[...readFileSync(folder+observation.crop)],observation,offset:placement.cropOffset});
    expect(result).toEqual(observation.bands.map(b=>b.positions));
  }
});
