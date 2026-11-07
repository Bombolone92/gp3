import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const source='tests/fixtures/anchored-picture-script/control.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/anchored-picture-script/reference.json','utf8'));
test('matches native picture geometry with script formatting and preserves it through editing',async({page},info)=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^page-baseline/,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue();await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
 await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const [i,c]of reference.cases.entries()){
  const canvas=page.locator('canvas.canvas-page').nth(i);await canvas.scrollIntoViewIfNeeded();
  writeFileSync(info.outputPath(c.name+'.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const bounds=await canvas.evaluate(canvas=>{
   const ratio=canvas.width/612,ctx=canvas.getContext('2d'),{data,width,height}=ctx.getImageData(0,0,canvas.width,canvas.height);let left=width,top=height,right=0,bottom=0;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(Math.max(r,g,b)-Math.min(r,g,b)>60){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}}
   return [left,top,right,bottom].map(v=>v/ratio);
  });
  for(let k=0;k<4;k++)expect(Math.abs(bounds[k]-c.bounds[k]),c.name+' bound '+k).toBeLessThanOrEqual(.8);
 }
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 expectBodyEditParts(out,parts);
 expect(new TextDecoder().decode(out['word/document.xml']).match(/vertAlign/g)).toHaveLength(9);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
