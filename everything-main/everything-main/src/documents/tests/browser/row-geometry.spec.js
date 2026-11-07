import {test,expect} from '@playwright/test';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const kind of ['row-merged-oversized-15','row-merged-later-15'])test(`edits continuing merged text with the correct page geometry in ${kind}`,async({page},info)=>{
 await page.setViewportSize({width:1280,height:1400});await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/row-geometry/${kind}-probe.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Merged minimum/);
 const original=await input.inputValue(),canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(4);
 const labels=kind==='row-merged-oversized-15'?['Left 053','Right second']:['Left 001','Right second'];
 const anchors=[];
 for(const label of labels){
  await input.evaluate((el,label)=>{const at=el.value.indexOf(label);el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},label);
  const expected=kind==='row-merged-oversized-15'?{page:3,y:132}:{page:1,y:100};
  await expect.poll(()=>input.evaluate((el,expected)=>{
   const canvas=document.querySelectorAll('canvas.canvas-page')[expected.page];
   return Math.abs(parseFloat(el.style.top)-canvas.offsetTop-expected.y);
  },expected)).toBeLessThan(1);
  anchors.push(await input.evaluate(el=>parseFloat(el.style.top)));
 }
 expect(Math.abs(anchors[0]-anchors[1])).toBeLessThan(1);
 await input.pressSequentially('X');await expect(input).toHaveValue(original.replace('Right second','XRight second'));
 await input.press('Control+z');await expect(input).toHaveValue(original);await expect(canvases).toHaveCount(4);
 for(const index of (kind==='row-merged-oversized-15'?[3]:[0,1,2])){await canvases.nth(index).scrollIntoViewIfNeeded();await canvases.nth(index).screenshot({path:info.outputPath(`${kind}-page-${index+1}.png`)});}
});
test('renders the independent row-padding probes for native comparison',async({page},info)=>{
  await page.setViewportSize({width:1280,height:1500});await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/row-geometry/row-padding-probe.docx');
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^min-none/);
  const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(12);
  for(const index of [3,9]){const canvas=canvases.nth(index);await canvas.scrollIntoViewIfNeeded();await canvas.screenshot({path:info.outputPath(`row-padding-${index}.png`)});}
});
test('omits and resumes repeated headers around oversized rows in modern compatibility',async({page},info)=>{
 await page.setViewportSize({width:1280,height:1400});await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/row-geometry/row-oversized-headers-15-probe.docx');
 await showAllTools(page);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^exact-prior0-header24/);
 await expect(input).toHaveValue(/atLeast-prior1-header48 line 084/);
 const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(32);
 for(const index of [2,3,16,17]){const canvas=canvases.nth(index);await canvas.scrollIntoViewIfNeeded();await canvas.screenshot({path:info.outputPath(`oversized-page-${index+1}.png`)});}
 // Hidden exact-row source remains editable, but its input/caret anchor must
 // stay at the physical bottom of that page rather than below the canvas.
 await input.evaluate(el=>{const at=el.value.indexOf('exact-prior0-header24 line 084');el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});
 await expect.poll(()=>input.evaluate(el=>{
   const canvas=document.querySelectorAll('canvas.canvas-page')[2];
   return Math.abs(parseFloat(el.style.top)+parseFloat(el.style.height)-canvas.offsetTop-canvas.clientHeight);
 })).toBeLessThanOrEqual(1);
 const label='exact-prior0-header24 line 000',original=await input.inputValue();
 await input.evaluate((el,label)=>{const at=el.value.indexOf(label)+label.length;el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},label);
 await input.pressSequentially('X');const edited=original.replace(label,label+'X');await expect(input).toHaveValue(edited);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
 const path=info.outputPath('row-geometry.docx');await(await pending).saveAs(path);await reopenDocx(page,input,path,edited);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(32);

});
