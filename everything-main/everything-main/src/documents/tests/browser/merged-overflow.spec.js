import {test,expect} from '@playwright/test';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
const cases=['row-merged-later-14',...['oversized','later'].flatMap(position=>[14,15].map(mode=>`row-merged-exact-${position}-${mode}`))];
for(const name of cases)test(`clips and edits merged overflow with package preservation: ${name}`,async({page},info)=>{
 await page.setViewportSize({width:1280,height:1400});await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/row-geometry/${name}-probe.docx`);await showAllTools(page);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Merged minimum/);
 const modernContinuation=name==='row-merged-exact-oversized-15',count=modernContinuation?4:3;
 const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(count);
 const hiddenLabel=modernContinuation?'Left 060':'Left 084',hiddenPage=modernContinuation?2:1;
 await input.evaluate((el,label)=>{const at=el.value.indexOf(label);el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},hiddenLabel);
 await expect.poll(()=>input.evaluate((el,index)=>{
  const canvas=document.querySelectorAll('canvas.canvas-page')[index];
  return Math.abs(parseFloat(el.style.top)+parseFloat(el.style.height)-canvas.offsetTop-canvas.clientHeight);
 },hiddenPage)).toBeLessThanOrEqual(1);
 const original=await input.inputValue(),label='Right second';
 await input.evaluate((el,label)=>{const at=el.value.indexOf(label)+label.length;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},label);
 await input.pressSequentially('X');const edited=original.replace(label,label+'X');await expect(input).toHaveValue(edited);
 await input.press('Control+z');await expect(input).toHaveValue(original);
 await input.press('Control+y');await expect(input).toHaveValue(edited);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
 const path=info.outputPath(`${name}-edited.docx`);await(await pending).saveAs(path);await reopenDocx(page,input,path,edited);
 await expect(canvases).toHaveCount(count);
 for(const index of [0,hiddenPage,count-1]){await canvases.nth(index).scrollIntoViewIfNeeded();await canvases.nth(index).screenshot({path:info.outputPath(`${name}-page-${index+1}.png`)});}
});
