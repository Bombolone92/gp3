import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const suffix of ['','-modern'])test(`matches native explicit overflowing table widths${suffix} through editing and reopening`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`public/fixtures/table-overflow-width${suffix}.docx`,ref=JSON.parse(readFileSync(`tests/fixtures/table-overflow-width/reference${suffix}.json`));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Table overflow controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async bytes=>{
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return p.tables.filter(t=>t.grid.length===2).map(t=>t.rows[0].cells.map(c=>{const b=layout.cells.find(b=>b.id===c.id);return {left:b.x*.75,width:b.width*.75};}));
  },[...bytes]);
  expect(actual).toHaveLength(12);
  ref.cases.forEach((row,i)=>row.forEach((cell,j)=>{
   for(const k of ['left','width'])expect(Math.abs(actual[i][j][k]-cell[k]),`case ${i+1} cell ${j+1} ${k}`).toBeLessThan(.5);
  }));
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(12);
  const colors=await page.evaluate(cases=>{
   const pages=[...document.querySelectorAll('canvas.canvas-page')];
   return cases.map((row,i)=>row.map(c=>{
    const canvas=pages[i],ctx=canvas.getContext('2d'),scale=canvas.width/612;
    return [c.left+3,c.left+c.width/2,c.left+c.width-3].map(x=>Array.from(ctx.getImageData(Math.round(x*scale),Math.round((c.top+25)*scale),1,1).data).slice(0,3));
   }));
  },ref.cases);
  for(const [i,row]of colors.entries())expect(row,`case ${i+1} cell fill coverage`).toEqual([Array(3).fill([51,102,153]),Array(3).fill([204,102,51])]);
 };
 const original=await input.inputValue();await check(readFileSync(source));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const save=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(`table-overflow${suffix}-${label}.docx`);await(await pending).saveAs(p);return p;};
 const edited=await save('edited');await check(readFileSync(edited));
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,'Edited '+original);await check(readFileSync(edited));
});
