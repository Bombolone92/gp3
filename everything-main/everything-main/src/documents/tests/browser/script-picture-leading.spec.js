import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test.use({permissions:['local-fonts']});
test('inline picture script formatting retains native automatic leading through edits',async({page},info)=>{
 test.setTimeout(180000);
 const root='tests/fixtures/script-picture-leading/',source=root+'controls.docx',bytes=readFileSync(source),reference=JSON.parse(readFileSync(root+'reference.json'));
 await page.addInitScript(()=>{
  window.afterPaints=new WeakMap();const fill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
   if(text==='After'&&this.canvas.classList.contains('canvas-page')){
    const m=this.getTransform(),scale=this.canvas.width/816;
    window.afterPaints.set(this.canvas,{x:(m.a*x+m.c*y+m.e)/scale*.75,y:(m.b*x+m.d*y+m.f)/scale*.75});
   }
   return fill.call(this,text,x,y,...args);
  };
 });
 await page.goto('/playground.html');const previous=await page.getByRole('textbox',{name:'Document text'}).elementHandle();
 await page.getByLabel('Open DOCX file').setInputFiles(source);await expect.poll(()=>previous.evaluate(e=>e.isConnected),{timeout:90000}).toBe(false);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toBeEditable();
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
  const actual=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>window.afterPaints.get(c)));
  for(const [i,c]of reference.cases.entries())for(const axis of ['x','y'])expect(Math.abs(actual[i][axis]-c.after[axis]),`${c.name} ${axis}`).toBeLessThan(reference.coordinateTolerancePt);
  // The native line-top API is quantized. Script invariance is independently
  // observed for each matched triple; do not weaken that comparison to .8 pt.
  for(let start=0;start<actual.length;start+=3)for(let offset=1;offset<3;offset++)expect(actual[start+offset].y).toBeCloseTo(actual[start].y,6);
  return actual;
 };
 writeFileSync(info.outputPath('painted-after-origins.json'),JSON.stringify(await check(),null,2));
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const file=info.outputPath(name+'.docx');await(await pending).saveAs(file);return file;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited');
 for(const [name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(unzipSync(readFileSync(edited))[name]).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'EDIT '+original);await check();
});
