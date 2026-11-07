import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/exact-row-page-fit/',source=root+'exact-row-page-fit-20261004.docx';
const native=JSON.parse(readFileSync(root+'reference.json'));
test('retains native full-page row placement through text editing, undo and export/reopen',async({page},info)=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^R0000/,{timeout:60000});
 await expect(input).toHaveJSProperty('readOnly',false);const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(native.pages);
  const counts=Array.from({length:native.pages},(_,p)=>native.rows.filter(r=>r.page===p).length);
  await expect.poll(()=>page.locator('canvas.canvas-page').evaluateAll((canvases,counts)=>canvases.map((c,p)=>{
   const ctx=c.getContext('2d'),pixel=r=>[...ctx.getImageData(Math.round(216*c.width/612),Math.round((46+20*r)*c.height/792),1,1).data].slice(0,3);
   return {last:pixel(counts[p]-1),after:counts[p]<36?pixel(counts[p]):null};
  }),counts),{timeout:30000}).toEqual(counts.map(n=>({last:[221,238,255],after:n<36?[255,255,255]:null})));
 };
 const save=async(name,edited)=>{
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);const after=unzipSync(readFileSync(path));
  expect(Object.keys(after).sort()).toEqual(Object.keys(parts).sort());for(const key of Object.keys(parts))if(!edited||key!=='word/document.xml')expect(after[key],key).toEqual(parts[key]);
  return path;
 };
 await check();await save('noedit',false);await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 await expect(input).toHaveValue('Edited '+original);await check();const edited=await save('edited',true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();await save('undo',false);
 await reopenDocx(page,input,edited,'Edited '+original);await check();expect(errors).toEqual([]);
});
