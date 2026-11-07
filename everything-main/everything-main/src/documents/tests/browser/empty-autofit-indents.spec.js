import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/empty-autofit-indents',ref=JSON.parse(readFileSync(`${folder}/reference.json`));
test.use({deviceScaleFactor:3});
test('matches native empty-cell AutoFit widths and preserves them through editing/export',async({page},info)=>{
 await page.goto('/playground.html');
 const installed=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});
 test.skip(!installed,'Native reference requires Arial.');
 await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/control.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^empty/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);
  const actual=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>{
   const scale=c.width/360,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let left=c.width,right=-1;
   for(let y=Math.round(35*scale);y<100*scale;y++)for(let x=0;x<c.width;x++){const k=(y*c.width+x)*4;if(d[k+1]>200&&d[k]<40&&d[k+2]<40){left=Math.min(left,x);right=Math.max(right,x);}}
   return{left:left/scale,right:(right+1)/scale};
  }));
  for(const[i,r]of ref.cases.entries()){expect(Math.abs(actual[i].left-r.left),r.name+' left').toBeLessThan(.6);expect(Math.abs(actual[i].right-r.right),r.name+' right').toBeLessThan(.6);}
  await expect(page.locator('#playground-error')).toBeEmpty();
 };
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath('empty-indents.docx');await(await pending).saveAs(path);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();await reopenDocx(page,input,path,'Edited '+original);await check();
});
