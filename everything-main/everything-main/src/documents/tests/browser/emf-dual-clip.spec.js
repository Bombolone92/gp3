import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/emf-dual-clip/',source=folder+'control.docx';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
test.use({deviceScaleFactor:3,viewport:{width:1400,height:1000}});
test('matches native clipped ink and keeps later text and editable exports intact',async({page},info)=>{
 for(const [name,hash] of [['control.docx',reference.sourceSha256],['native.pdf',reference.pdfSha256]])expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape defaults controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  const results=await page.locator('canvas.canvas-page').evaluate((canvas,cases)=>{
   const ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cases.map(c=>c.regions.map(({bounds:[l,t,r,b]})=>{
    const x=Math.round(l*scale),y=Math.round(t*scale),w=Math.round((r-l)*scale),h=Math.round((b-t)*scale),pixels=ctx.getImageData(x,y,w,h).data;
    let ink=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
     const i=(py*w+px)*4,red=pixels[i],green=pixels[i+1],blue=pixels[i+2];
     if(blue>red+20&&red<180){ink+=1-(red+green+blue)/765;left=Math.min(left,(x+px)/scale);top=Math.min(top,(y+py)/scale);right=Math.max(right,(x+px+1)/scale);bottom=Math.max(bottom,(y+py+1)/scale);}
    }return {ink:ink*(4/scale)**2,box:ink?[left,top,right,bottom]:null};
   }));
  },reference.cases);
  for(const [i,c] of reference.cases.entries())for(const [j,r] of c.regions.entries()){
   const actual=results[i][j],label=`${c.name} line ${j}`;
   if(!r.ink){expect(actual.ink,label).toBe(0);continue;}
   expect(actual.ink/r.ink,label+' ink').toBeGreaterThan(.94);expect(actual.ink/r.ink,label+' ink').toBeLessThan(1.06);
   for(let k=0;k<4;k++)expect(Math.abs(actual.box[k]-r.box[k]),label+' bounds').toBeLessThan(.8);
  }
 };
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async name=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await download).saveAs(path);return path;};
 const edited=await save('edited'),a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(edited));for(const n of Object.keys(a))if(n!=='word/document.xml')expect(b[n]).toEqual(a[n]);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(a);
 await reopenDocx(page,input,edited,'Edited '+original);await check();await expect(page.locator('#playground-error')).toBeEmpty();
});
