import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/merged-shading-gap/paged.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/merged-shading-gap/paged-reference.json','utf8'));
test('matches native paginated merged shading edges and preserves editing and export',async({page},info)=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^neighbor-last-only/,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue();await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
 await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const [i,c]of reference.cases.entries()){
  const canvas=page.locator('canvas.canvas-page').nth(i);await canvas.scrollIntoViewIfNeeded();
  writeFileSync(info.outputPath(c.name+'.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  // Classify blue coverage rather than exact RGB: guides and fractional cell
  // edges blend it with white, while a real unpainted gap has no blue coverage.
  const spans=await canvas.evaluate(canvas=>{
   const ratio=canvas.width/612,ctx=canvas.getContext('2d'),{data,width,height}=ctx.getImageData(Math.round(290*ratio),0,Math.ceil(20*ratio),canvas.height),spans=[];let start=null;
   for(let y=0;y<=height;y++){let ink=false;if(y<height)for(let x=0;x<width;x++)if(data[(y*width+x)*4+2]-data[(y*width+x)*4]>40 && data[(y*width+x)*4+1]>data[(y*width+x)*4]){ink=true;break;}if(ink&&start===null)start=y;if(!ink&&start!==null){spans.push([start/ratio,y/ratio]);start=null;}}
   return spans;
  });
  expect(spans.length,c.name).toBe(c.spans.length);
  for(let j=0;j<spans.length;j++)for(let k=0;k<2;k++)expect(Math.abs(spans[j][k]-c.spans[j][k]),c.name+' span '+j).toBeLessThanOrEqual(.8);
 }
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(bytes);

 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original,{timeout:120000});await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
