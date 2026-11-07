import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/first-cell-keep',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
for(const [name,ref] of Object.entries(refs))test(`${name}: matches native cell keep pagination through edit and reopen`,async({page},info)=>{
 await page.addInitScript(()=>{window.keepPaint=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){window.keepPaint.push({text,canvas:this.canvas});return original.call(this,text,x,y,...args);};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/${name}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Filler/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 const actual=await page.evaluate(markers=>Object.fromEntries(markers.map(m=>[m,[...document.querySelectorAll('canvas.canvas-page')].flatMap((canvas,i)=>window.keepPaint.some(e=>e.canvas===canvas&&e.text===m)?[i]:[])])),Object.keys(ref.markers));
 for(const [m,pages]of Object.entries(ref.markers))expect(actual[m],m).toEqual([...new Set(pages)]);
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}-edited.docx`);await(await pending).saveAs(path);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await reopenDocx(page,input,path,'Edited '+original);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);await expect(page.locator('#playground-error')).toBeEmpty();
});
