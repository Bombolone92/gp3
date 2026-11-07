import {test,expect} from '@playwright/test';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';

test('paints compatible nil conflicts and preserves their declarations through editing',async({page},info)=>{
  await page.goto('/playground.html');await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/nil-border-conflicts.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^horizontal-nil-single/);
  const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(12);
  for(let index=0;index<12;index++){
    const canvas=canvases.nth(index);await canvas.scrollIntoViewIfNeeded();
    const count=()=>canvas.evaluate(el=>{
      const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let green=0,blue=0;
      for(let i=0;i<data.length;i+=4){if(data[i]<5&&data[i+1]>160&&data[i+1]<180&&data[i+2]<5)green++;if(data[i]<5&&data[i+1]<5&&data[i+2]>250)blue++;}
      return {green,blue};
    });
    if(index%6<2)await expect.poll(async()=>(await count()).green).toBeGreaterThan(20);
    else if(index%6===2)expect(await count()).toEqual({green:0,blue:0});
    else await expect.poll(async()=>(await count()).blue).toBeGreaterThan(20);
  }
  const original=await input.inputValue();await input.evaluate(el=>{const at=el.value.indexOf('First')+5;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});
  await input.pressSequentially('X');const expected=original.replace('First','FirstX');await expect(input).toHaveValue(expected);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('nil-border-conflicts.docx');await(await pending).saveAs(path);await reopenDocx(page,input,path,expected);
});
