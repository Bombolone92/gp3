import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
test.use({ permissions: ['local-fonts'] });
const folder = 'tests/fixtures/synthetic-bold-advance/';
const sameParts = (actual, expected, except = []) => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true);
};
for (const name of ['modern', 'thousand', 'ligatures']) {
 const cases = JSON.parse(readFileSync(folder + name + '-cases.json'));
 const native = JSON.parse(readFileSync(folder + name + '-native.json', 'utf8').replace(/^\uFEFF/, ''));
 async function widths(page) {
  await page.goto('/playground.html');
  return page.evaluate(async cases => {
   const { prepareCanvasFont, fontAvailable } = await import('/src/engine/font-availability.js');
   const { measureCanvasText } = await import('/src/engine/canvas-text.js');
   await Promise.all([...new Set(cases.map(c => c.family))].map(prepareCanvasFont));
   const ctx = document.createElement('canvas').getContext('2d');
   return cases.map(c => ({ available: fontAvailable(c.family), width: measureCanvasText(ctx, c.text, { fontFamily:c.family, fontSize:c.size, bold:c.bold, kerning:0, ligatures:c.ligatures || 'none' }).width * .75 }));
  }, cases);
 }
 test(`${name}: ordinary advances match native whole-twip fit thresholds`, async ({page}) => {
  const actual=await widths(page); let count=0;
  for(const [i,c] of cases.entries()) if(actual[i].available && (!c.bold || ['Arial','Arial Black'].includes(c.family))) {
   expect(Math.ceil(actual[i].width*20-1e-5), `row ${i}`).toBe(native.cases[i].minimumTwips); count++;
  }
  expect(count).toBeGreaterThan(0);
 });
 test(`${name}: synthetic bold advances match native fit thresholds`, async ({page},info) => {
  const actual=await widths(page);
  const rows=cases.flatMap((c,i)=>actual[i].available && c.bold && !['Arial','Arial Black'].includes(c.family) ? [{index:i,actual:Math.ceil(actual[i].width*20-1e-5),expected:native.cases[i].minimumTwips}] : []);
  expect(rows.length).toBeGreaterThan(0); writeFileSync(info.outputPath('native-width-gaps.json'),JSON.stringify(rows,null,2));
  expect(rows.map(r=>r.actual)).toEqual(rows.map(r=>r.expected));
 });
 test(`${name}: native advance control preserves editable package and undo`,async({page},info)=>{
  await page.goto('/playground.html');const source=folder+name+'.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^(Careful readers|office affinity)/);await expect(input).toHaveJSProperty('readOnly',false);
  const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(name==='modern'?2:1);
  for(let i=0;i<await canvases.count();i++)writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(await canvases.nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const save=async label=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(label+'.docx');await(await event).saveAs(path);return path;};
  sameParts(unzipSync(readFileSync(await save('noedit'))),parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');sameParts(unzipSync(readFileSync(edited)),parts,['word/document.xml']);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);sameParts(unzipSync(readFileSync(await save('undo'))),parts);
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);
 });
}
test('native synthetic advances also match fill-only medium and semibold faces',async({page})=>{
 const cases=JSON.parse(readFileSync(folder+'weights-cases.json')),ref=JSON.parse(readFileSync(folder+'weights-native.json','utf8').replace(/^\uFEFF/,''));
 await page.goto('/playground.html');
 const actual=await page.evaluate(async cases=>{
  const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js'),{measureCanvasText}=await import('/src/engine/canvas-text.js');
  await Promise.all([...new Set(cases.map(c=>c.family))].map(prepareCanvasFont));const ctx=document.createElement('canvas').getContext('2d');
  return cases.map(c=>({available:fontAvailable(c.family),width:measureCanvasText(ctx,c.text,{fontFamily:c.family,fontSize:c.size,bold:c.bold,kerning:0,ligatures:'none'}).width*.75}));
 },cases);
 let count=0;for(const [i,c]of cases.entries())if(actual[i].available){expect(Math.ceil(actual[i].width*20-1e-5),`${c.family} ${c.bold}`).toBe(ref.cases[i].minimumTwips);count++;}
 test.skip(!count,'Native boundary fonts are unavailable.');
});
