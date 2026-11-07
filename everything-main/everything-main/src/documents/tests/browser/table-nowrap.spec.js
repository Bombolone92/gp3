import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const suffix of [''])test(`matches native noWrap cell widths${suffix} through editing and reopening`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`public/fixtures/table-no-wrap.docx`,ref=JSON.parse(readFileSync(`tests/fixtures/table-nowrap/reference${suffix}.json`));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/table-nowrap/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Cell wrapping controls/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async bytes=>{
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return p.tables.filter(t=>t.grid.length===2).map(t=>t.rows[0].cells.map(c=>{const b=layout.cells.find(b=>b.id===c.id);return {left:b.x*.75,width:b.width*.75,top:b.y*.75,height:b.height*.75};}));
  },[...bytes]);
  expect(actual).toHaveLength(28);
  ref.cases.forEach((row,i)=>row.forEach((cell,j)=>{
   for(const k of ['left','width'])expect(Math.abs(actual[i][j][k]-cell[k]),`case ${i+1} cell ${j+1} ${k}`).toBeLessThan(.5);
  }));
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(28);
  const colors=await page.evaluate(cases=>{
   const pages=[...document.querySelectorAll('canvas.canvas-page')];
   return cases.map((row,i)=>row.map((c,j)=>{
    const canvas=pages[i],ctx=canvas.getContext('2d'),scale=canvas.width/612;
    // Inspect strips rather than isolated pixels that can land on glyphs.
    const fill=j===0?[51,102,153]:[204,102,51];
    return [c.left+3,c.left+c.width/2,c.left+c.width-3].map(x=>{
     const data=ctx.getImageData(Math.round(x*scale),Math.ceil((c.top+1)*scale),1,Math.max(1,Math.floor((c.height-2)*scale))).data;
     for(let k=0;k<data.length;k+=4)if(fill.every((v,n)=>data[k+n]===v))return true;
     return false;
    });
   }));
  },actual);
  for(const [i,row]of colors.entries())expect(row,`case ${i+1} cell fill coverage`).toEqual([Array(3).fill(true),Array(3).fill(true)]);
 };
 const original=await input.inputValue();await check(readFileSync(source));
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const save=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const p=info.outputPath(`table-nowrap${suffix}-${label}.docx`);await(await pending).saveAs(p);return p;};
 const edited=await save('edited');await check(readFileSync(edited));
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,'Edited '+original);await check(readFileSync(edited));
});
