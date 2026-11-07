import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const root='tests/fixtures/narrow-filled-paths/',ref=JSON.parse(readFileSync(root+'reference.json'));
test.use({deviceScaleFactor:1});
test.setTimeout(120000);
test('thin filled strips retain native screen coverage without a synthesized stroke',async({page},info)=>{
 await page.goto('/playground.html');const input=page.getByRole('textbox',{name:'Document text'}),old=await input.elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');await expect.poll(()=>old.evaluate(e=>e.isConnected)).toBe(false);
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const measurements=await page.locator('canvas.canvas-page').evaluate((canvas,cases)=>{
  const ctx=canvas.getContext('2d'),scale=canvas.width/612;
  return cases.map(c=>{const x=Math.round((c.xPt+30)*scale),y=Math.round(c.yPt*scale),base=ctx.getImageData(x,y-5,1,1).data[0],denominator=c.color==='FFFFFF'?255-base:base,sign=c.color==='FFFFFF'?1:-1;
   let coverage=0;for(let j=y-2;j<y+8;j++)coverage+=sign*(ctx.getImageData(x,j,1,1).data[0]-base)/denominator;
   return {name:c.name,coverage,error:Math.abs(coverage-c.nativeScreenCoveragePx)};});
 },ref.cases);
 writeFileSync(info.outputPath('coverage.json'),JSON.stringify(measurements,null,2));
 // This screen-coverage bound does not claim identical antialiasing. Adding
 // a one-pixel minimum to filled geometry must fail the subpixel controls.
 for(const m of measurements)expect(m.error,m.name).toBeLessThan(.2);
 const original=unzipSync(readFileSync(root+'control.docx')),text=await input.inputValue();
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,parts:unzipSync(readFileSync(path))};};
 expect((await save('noedit')).parts).toEqual(original);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited');for(const n of Object.keys(original))if(n!=='word/document.xml')expect(edited.parts[n]).toEqual(original[n]);
 await input.press('ControlOrMeta+z');expect((await save('undo')).parts).toEqual(original);page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited.path);
 await expect(input).toHaveValue('Edited '+text);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 await expect(page.locator('#playground-error')).toBeEmpty();
});
