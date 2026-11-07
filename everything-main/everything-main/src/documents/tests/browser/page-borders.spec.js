import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/page-borders',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
test.use({deviceScaleFactor:3});
for(const name of Object.keys(refs))test(`${name}: paints native page borders and retains editable section settings`,async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/${name}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^(Case|Overlap)/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(refs[name].pages.length);
 const values=await page.locator('canvas.canvas-page').evaluateAll((canvases,name)=>canvases.map(c=>{
  const ctx=c.getContext('2d'),w=c.width,h=c.height,scale=w/612;const pixel=(x,y)=>Array.from(ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data).slice(0,3);
  if(name==='overlap')return [[150,27],[27,55],[150,45]].map(([x,y])=>pixel(x*scale,y*scale));
  const result={};for(const side of ['top','left','bottom','right']){const vertical=['top','bottom'].includes(side),extent=vertical?h:w,leading=['top','left'].includes(side),ink=[];
   for(let v=leading?0:extent-60*scale;v<(leading?60*scale:extent);v++)if(Math.max(...pixel(vertical?w/2:v,vertical?v:h/2))<250)ink.push(v);
   result[side]=ink.length?[Math.min(...ink)/scale,(Math.max(...ink)+1)/scale]:null;
  }if(result.left&&result.top)result.corner=pixel((result.left[0]+2)*scale,(result.top[0]+2)*scale);return result;
 }),name);
 for(const[i,ref]of refs[name].pages.entries()){
  if(ref.corner)expect(values[i].corner).toEqual(ref.corner[2]);
  if(name==='overlap')expect(values[i]).toEqual(ref);
  else for(const side of ['top','left','bottom','right']){if(ref[side]===null)expect(values[i][side]).toBeNull();else{expect(values[i][side]).not.toBeNull();for(let j=0;j<2;j++)expect(Math.abs(values[i][side][j]-ref[side][j]),`${i}/${side}/${j}`).toBeLessThanOrEqual(.3);}}
 }
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}-edited.docx`);await(await pending).saveAs(path);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await reopenDocx(page,input,path,'Edited '+original);await expect(page.locator('canvas.canvas-page')).toHaveCount(refs[name].pages.length);await expect(page.locator('#playground-error')).toBeEmpty();
});
