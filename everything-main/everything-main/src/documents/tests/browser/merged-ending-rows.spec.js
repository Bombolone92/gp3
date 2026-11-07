import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
for(const mode of [14,15])test(`matches native merged ending rows in compatibility ${mode}`,async({page},info)=>{
 const folder='tests/fixtures/merged-ending-rows/',source=folder+`controls-${mode}.docx`,ref=JSON.parse(readFileSync(folder+`native-${mode}.json`));
 for(const[file,hash]of [[source,ref.sourceSha256],[folder+`native-${mode}.pdf`,ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
 await expect(input).toHaveValue(/^Case 1/);await expect(input).toBeEditable();await expect(canvases).toHaveCount(16);await input.blur();
 for(const[i,p]of ref.pages.entries()){
  const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();
  await expect.poll(()=>canvas.evaluate((c,markers)=>{
   const scale=c.width/576,ctx=c.getContext('2d');
   return markers.map(m=>{const[x,y,r,b]=m.region.map(v=>Math.round(v*scale)),w=r-x,h=b-y,d=ctx.getImageData(x,y,w,h).data;let l=w,t=h,right=0,bottom=0;
    for(let j=0;j<h;j++)for(let k=0;k<w;k++){const at=(j*w+k)*4;if(d[at]<160&&d[at+1]<160&&d[at+2]<160){l=Math.min(l,k);t=Math.min(t,j);right=Math.max(right,k+1);bottom=Math.max(bottom,j+1);}}
    const actual=right?[(x+l)/scale,(y+t)/scale,(x+right)/scale,(y+bottom)/scale]:null;
    return {label:m.label,ok:m.inkBox?actual&&actual.every((v,j)=>Math.abs(v-m.inkBox[j])<=1.5):actual===null};
   }).filter(v=>!v.ok);
  },p.markers),{message:`mode ${mode} page ${i+1}`}).toEqual([]);
 }
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const text=await input.inputValue(),edited=await save('edited');
 expectBodyEditParts(unzipSync(readFileSync(edited)),parts);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,text);await expect(input).toBeEditable();await expect(canvases).toHaveCount(16);
});
