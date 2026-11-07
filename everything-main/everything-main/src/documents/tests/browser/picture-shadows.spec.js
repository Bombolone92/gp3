import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder='tests/fixtures/picture-shadows/',source=folder+'source.docx';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const cases=JSON.parse(readFileSync(folder+'cases.json'));
test('matches native picture shadow colors, profiles and obscuration through edit and reopen',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^baseline/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);await expect(page.locator('#playground-error')).toBeEmpty();
  const actual=await page.locator('canvas.canvas-page').evaluateAll((cs,ref)=>cs.map(c=>{
   const ctx=c.getContext('2d'),scale=c.width/432;
   const sample=([x,y])=>[...ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data].slice(0,3);
   return {samples:Object.fromEntries(Object.entries(ref.samplePointsPt).map(([k,p])=>[k,sample(p)])),profiles:Object.fromEntries(Object.entries(ref.profilePointsPt).map(([k,ps])=>[k,ps.map(sample)]))};
  }),ref);
  for(const [i,r]of ref.pages.entries()){
   for(const key of ['transparent','halfAlpha','opaqueBlue','opaqueYellow'])for(let c=0;c<3;c++)expect(Math.abs(actual[i].samples[key][c]-r.samples[key][c]),`${r.name} ${key} ${c}`).toBeLessThanOrEqual(4);
   // The reference PDF embeds a lower-resolution bitmap for larger blur radii. Allow
   // one native shadow texel plus half a CSS pixel of edge-position sampling,
   // while requiring the color to match within three levels in that interval.
   const blur=cases[i][1].blur||0,texel=i?(144+2*blur)/r.pdfImages[0].size[0]:0;
   const radius=Math.ceil((texel+.375)/.5);
   for(const [edge,values]of Object.entries(r.profiles))for(const [j,rgb]of actual[i].profiles[edge].entries()){
    const [x,y]=ref.profilePointsPt[edge][j],frame=ref.framePt;
    // Measure the shadow outside the picture, excluding its one-CSS-pixel
    // coverage fringe. Foreground pixels and 3D silhouette geometry belong to
    // the existing image/3D controls; their rasterization is not shadow blur.
    if(x>=frame.x-.75&&x<=frame.x+frame.width+.75&&y>=frame.y-.75&&y<=frame.y+frame.height+.75)continue;
    const candidates=values.slice(Math.max(0,j-radius),Math.min(values.length,j+radius+1));
    const errors=candidates.map(v=>Math.max(...v.map((c,k)=>Math.abs(c-rgb[k]))));
    // Interpolate the measured profile: rasterizers can sample opposite sides
    // of a sharp edge, so a subpixel coverage color need not equal a saved texel.
    for(let k=1;k<candidates.length;k++){
     const a=candidates[k-1],b=candidates[k],delta=b.map((v,c)=>v-a[c]),den=delta.reduce((s,v)=>s+v*v,0);
     const t=den?Math.max(0,Math.min(1,delta.reduce((s,v,c)=>s+v*(rgb[c]-a[c]),0)/den)):0;
     errors.push(Math.max(...rgb.map((v,c)=>Math.abs(v-a[c]-t*delta[c]))));
    }
    const error=Math.min(...errors);
    expect(error,`${r.name} ${edge} ${j}`).toBeLessThanOrEqual(3);
   }
  }
 };
 await check();
 for(const[i,data]of(await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edit ');const edited=await save('edited');await check();
 await input.press('ControlOrMeta+z');const before=unzipSync(readFileSync(source)),undo=unzipSync(readFileSync(await save('undo')));
 expect(Object.keys(undo).sort()).toEqual(Object.keys(before).sort());for(const n of Object.keys(before))expect(Buffer.from(undo[n]).equals(Buffer.from(before[n])),n).toBe(true);
 await reopenDocx(page,input,edited,'Edit '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});
