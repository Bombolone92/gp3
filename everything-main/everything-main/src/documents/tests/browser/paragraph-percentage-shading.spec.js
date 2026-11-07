import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/paragraph-percentage-shading/';
const refs=JSON.parse(readFileSync(root+'reference.json','utf8'));
for(const ref of refs)test(`${ref.source}: matches native shading on every page and retains patterns on edit`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(root+ref.source);const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^C01 pct5/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const colors=await page.locator('canvas.canvas-page').evaluateAll((canvases,rows)=>rows.map(row=>{
   const c=canvases[row.page],scale=c.width/612;return Array.from(c.getContext('2d').getImageData(Math.round(row.x*scale),Math.round(row.y*scale),1,1).data).slice(0,3);
  }),ref.rows);
  expect(colors).toEqual(ref.rows.map(r=>r.rgb));
 };
 await check();const original=await input.inputValue();
 for(const[i,url]of(await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(url.split(',')[1],'base64'));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(root+ref.source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(out[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await check();await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
